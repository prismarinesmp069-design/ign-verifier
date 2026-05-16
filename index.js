const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const express = require('express');

// ==================== KEEP-ALIVE SERVER ====================
const keepAliveApp = express();
keepAliveApp.get('/', (req, res) => {
    res.send('✅ IGN Verifier Bot is running!');
});
keepAliveApp.listen(3000, () => {
    console.log('🌐 Keep-alive server running on port 3000');
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const TOKEN = process.env.IGN_TOKEN;
const CLIENT_ID = process.env.IGN_CLIENT_ID;
const GUILD_ID = process.env.IGN_GUILD_ID;

// ==================== CONFIGURATION ====================
const VERIFIED_ROLE_NAME = '✅ Verified';
const PLAYER_ROLE_NAME = '⚔️ Player';
const UNVERIFIED_ROLE_NAME = '☘️ Unverified';
const VERIFY_CHANNEL_NAME = 'verify';
const LOG_CHANNEL_NAME = 'logs';
const REMINDER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const EDITION_ROLES = {
    'java': { name: '☕ Java Edition', emoji: '☕', color: 0xE67E22 },
    'bedrock': { name: '🟩 Bedrock Edition', emoji: '🟩', color: 0x2ECC71 }
};

const DEVICE_ROLES = {
    'mobile': { name: '📱 Mobile', emoji: '📱', color: 0x3498DB },
    'pc': { name: '🖥 PC', emoji: '🖥', color: 0x9B59B6 },
    'controller': { name: '🎮 Controller', emoji: '🎮', color: 0xE91E63 },
    'playstation': { name: '🟦 PlayStation', emoji: '🟦', color: 0x1ABC9C },
    'switch': { name: '🔴 Switch', emoji: '🔴', color: 0xE74C3C }
};

const REGION_ROLES = {
    'asia': { name: '🌏 Asia', emoji: '🌏', color: 0xF39C12 },
    'europe': { name: '🌍 Europe', emoji: '🌍', color: 0x2ECC71 },
    'america': { name: '🌎 America', emoji: '🌎', color: 0x3498DB },
    'africa': { name: '🌍 Africa', emoji: '🌍', color: 0xE67E22 },
    'oceania': { name: '🌏 Oceania', emoji: '🌏', color: 0x1ABC9C }
};

// ==================== DATABASE ====================
const DATA_FILE = 'igns.json';
let ignData = {};
let ignToUser = {};
let lastReminder = {};

if (fs.existsSync(DATA_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        ignData = data.ignData || {};
        ignToUser = data.ignToUser || {};
        lastReminder = data.lastReminder || {};
    } catch(e) {}
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ ignData, ignToUser, lastReminder }, null, 2));
}

// ==================== HELPER FUNCTIONS ====================
async function checkJavaUsername(username) {
    try {
        const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
        if (!res.ok) return null;
        return await res.json();
    } catch(e) {
        return null;
    }
}

async function checkBedrockUsername(username) {
    if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) return null;
    return { name: username, valid: true };
}

async function getRole(guild, name, color, reason) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) {
        try {
            role = await guild.roles.create({ name, color, reason });
        } catch(e) {
            console.error(`Failed to create role ${name}:`, e.message);
        }
    }
    return role;
}

async function setupRoles(guild) {
    const roles = {};
    
    roles.verified = await getRole(guild, VERIFIED_ROLE_NAME, 0x2ECC71, 'Verified members');
    roles.player = await getRole(guild, PLAYER_ROLE_NAME, 0xF1C40F, 'Players');
    roles.unverified = await getRole(guild, UNVERIFIED_ROLE_NAME, 0x7F8C8D, 'Unverified members');
    
    for (const [key, data] of Object.entries(EDITION_ROLES)) {
        roles[`edition_${key}`] = await getRole(guild, data.name, data.color, `Edition: ${data.name}`);
    }
    
    for (const [key, data] of Object.entries(DEVICE_ROLES)) {
        roles[`device_${key}`] = await getRole(guild, data.name, data.color, `Device: ${data.name}`);
    }
    
    for (const [key, data] of Object.entries(REGION_ROLES)) {
        roles[`region_${key}`] = await getRole(guild, data.name, data.color, `Region: ${data.name}`);
    }
    
    let logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
    roles.logChannel = logChannel;
    
    return roles;
}

// ==================== COMMAND REGISTRATION ====================
async function registerCommands() {
    const commands = [
        { name: 'sendverify', description: '[Staff] Send verification button message' },
        { name: 'notify', description: '[Staff] Send verification reminder to all unverified members' },
        { name: 'help', description: '[Staff] Show all commands' },
        { name: 'forceverify', description: '[Staff] Force verify a member', options: [{ name: 'member', type: 6, description: 'Member to verify', required: true }] },
        { name: 'unverify', description: '[Staff] Remove verification', options: [{ name: 'member', type: 6, description: 'Member to unverify', required: true }] },
        { name: 'checkign', description: '[Staff] Check member IGN', options: [{ name: 'member', type: 6, description: 'Member to check', required: true }] },
        { name: 'changedevice', description: '[Staff] Change member device', options: [{ name: 'member', type: 6, description: 'Member to change', required: true }, { name: 'device', type: 3, description: 'New device', required: true, choices: Object.keys(DEVICE_ROLES).map(d => ({ name: DEVICE_ROLES[d].name, value: d })) }] },
        { name: 'changeregion', description: '[Staff] Change member region', options: [{ name: 'member', type: 6, description: 'Member to change', required: true }, { name: 'region', type: 3, description: 'New region', required: true, choices: Object.keys(REGION_ROLES).map(r => ({ name: REGION_ROLES[r].name, value: r })) }] },
        { name: 'changeedition', description: '[Staff] Change member edition', options: [{ name: 'member', type: 6, description: 'Member to change', required: true }, { name: 'edition', type: 3, description: 'New edition', required: true, choices: [{ name: '☕ Java Edition', value: 'java' }, { name: '🟩 Bedrock Edition', value: 'bedrock' }] }] }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered');
}

// ==================== SEND VERIFY BUTTON ====================
async function sendVerifyMessage(channel) {
    const embed = {
        title: '🔐 MINECRAFT ACCOUNT VERIFICATION',
        description: `━━━━━━━━━━━━━━━━━━━━\nClick the button below to verify your Minecraft account.\n\n**You will need:**\n• Your Minecraft username\n• Your game edition (Java/Bedrock)\n• Your device\n• Your region\n━━━━━━━━━━━━━━━━━━━━`,
        color: 0x2ECC71,
        footer: { text: 'Verification is required to access the server' }
    };
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_button')
            .setLabel('✅ VERIFY NOW')
            .setStyle(ButtonStyle.Success)
    );
    
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await msg.pin().catch(() => {});
}

// ==================== VERIFICATION MODAL ====================
async function showVerificationModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('verificationModal')
        .setTitle('Minecraft Account Verification');
    
    const usernameInput = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('Minecraft Username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Enter your Minecraft username');
    
    const editionSelect = new StringSelectMenuBuilder()
        .setCustomId('edition')
        .setPlaceholder('Select your game edition')
        .addOptions([
            { label: '☕ Java Edition', value: 'java' },
            { label: '🟩 Bedrock Edition', value: 'bedrock' }
        ]);
    
    const deviceSelect = new StringSelectMenuBuilder()
        .setCustomId('device')
        .setPlaceholder('Select your device')
        .addOptions(Object.entries(DEVICE_ROLES).map(([val, data]) => ({ label: data.name, value: val })));
    
    const regionSelect = new StringSelectMenuBuilder()
        .setCustomId('region')
        .setPlaceholder('Select your region')
        .addOptions(Object.entries(REGION_ROLES).map(([val, data]) => ({ label: data.name, value: val })));
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(usernameInput),
        new ActionRowBuilder().addComponents(editionSelect),
        new ActionRowBuilder().addComponents(deviceSelect),
        new ActionRowBuilder().addComponents(regionSelect)
    );
    
    await interaction.showModal(modal);
}

// ==================== VERIFY MEMBER ====================
async function verifyMember(member, ign, edition, device, region, staffOverride = false) {
    const guild = member.guild;
    const roles = await setupRoles(guild);
    
    if (member.roles.cache.has(roles.verified.id)) {
        return { success: false, message: '❌ You are already verified!' };
    }
    
    if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(ign)) {
        return { success: false, message: '❌ Invalid username. Use 3-16 letters, numbers, underscores, or spaces.' };
    }
    
    if (ignToUser[ign] && ignToUser[ign] !== member.id) {
        return { success: false, message: '❌ This username is already verified by another member.' };
    }
    
    if (!staffOverride) {
        if (edition === 'java') {
            const mojang = await checkJavaUsername(ign);
            if (!mojang) {
                return { success: false, message: '❌ Java username does not exist on Mojang.' };
            }
            ign = mojang.name;
        } else {
            const bedrock = await checkBedrockUsername(ign);
            if (!bedrock) {
                return { success: false, message: '❌ Invalid Bedrock username.' };
            }
        }
    }
    
    try {
        await member.setNickname(ign);
    } catch(e) {
        return { success: false, message: '❌ Failed to set nickname. Bot role needs to be higher.' };
    }
    
    if (roles.unverified && member.roles.cache.has(roles.unverified.id)) {
        await member.roles.remove(roles.unverified);
    }
    
    await member.roles.add(roles.verified);
    await member.roles.add(roles.player);
    
    const editionRoleKey = `edition_${edition}`;
    if (roles[editionRoleKey]) await member.roles.add(roles[editionRoleKey]);
    
    const deviceRoleKey = `device_${device}`;
    if (roles[deviceRoleKey]) await member.roles.add(roles[deviceRoleKey]);
    
    const regionRoleKey = `region_${region}`;
    if (roles[regionRoleKey]) await member.roles.add(roles[regionRoleKey]);
    
    ignData[member.id] = { ign, edition, device, region, verifiedAt: new Date().toISOString() };
    ignToUser[ign] = member.id;
    delete lastReminder[member.id];
    saveData();
    
    if (roles.logChannel) {
        roles.logChannel.send(`✅ **${member.user.tag}** verified as **${ign}** (${edition} | ${device} | ${region})`);
    }
    
    try {
        await member.send(`✅ **Welcome!** Verified as **${ign}**\nEdition: ${edition === 'java' ? '☕ Java' : '🟩 Bedrock'}\nDevice: ${DEVICE_ROLES[device].name}\nRegion: ${REGION_ROLES[region].name}`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${ign}**! You now have access to all channels.` };
}

// ==================== SEND REMINDERS ====================
async function sendReminders(guild) {
    const roles = await setupRoles(guild);
    if (!roles.unverified) return;
    
    const members = await guild.members.fetch();
    const now = Date.now();
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(roles.verified.id)) continue;
        if (!member.roles.cache.has(roles.unverified.id)) continue;
        
        const last = lastReminder[member.id] || 0;
        if (now - last >= REMINDER_INTERVAL_MS) {
            try {
                await member.send(`**Reminder:** Verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL_NAME} to access ${guild.name}.`);
                lastReminder[member.id] = now;
                saveData();
            } catch(e) {}
        }
    }
}

// ==================== READY EVENT ====================
client.once('ready', async () => {
    console.log(`✅ IGN Verifier logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        console.error('❌ Guild not found! Check GUILD_ID.');
        return;
    }
    
    await setupRoles(guild);
    await registerCommands();
    
    const roles = await setupRoles(guild);
    const members = await guild.members.fetch();
    let count = 0;
    let notifiedCount = 0;
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (!member.roles.cache.has(roles.verified.id) && !member.roles.cache.has(roles.unverified.id)) {
            await member.roles.add(roles.unverified);
            count++;
        }
        if (!member.roles.cache.has(roles.verified.id) && member.roles.cache.has(roles.unverified.id) && !ignData[member.id]) {
            try {
                await member.send(`**🔐 ${guild.name} - Verification Required**\n━━━━━━━━━━━━━━━━━━━━\nTo access the server, please verify your Minecraft account.\n\nClick the **VERIFY NOW** button in the #${VERIFY_CHANNEL_NAME} channel to start.\n━━━━━━━━━━━━━━━━━━━━\nYou will need:\n• Your Minecraft username\n• Your game edition (Java/Bedrock)\n• Your device\n• Your region`);
                notifiedCount++;
                await new Promise(r => setTimeout(r, 1000));
                lastReminder[member.id] = Date.now();
            } catch(e) {
                console.log(`Could not DM ${member.user.tag}`);
            }
        }
    }
    saveData();
    
    console.log(`✅ Ready | Gave ☘️ Unverified to ${count} members`);
    console.log(`📨 Sent verification DM to ${notifiedCount} existing members`);
    console.log('📌 Use /sendverify in #verify channel');
    console.log('📌 Use /notify to send reminders to all unverified members');
    
    // Start reminder loop
    setInterval(() => sendReminders(guild), 60 * 1000);
});

// ==================== NEW MEMBER ====================
client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    const roles = await setupRoles(member.guild);
    if (!member.roles.cache.has(roles.verified.id) && roles.unverified) {
        await member.roles.add(roles.unverified);
    }
    try {
        await member.send(`**🔐 ${member.guild.name} - Verification Required**\n━━━━━━━━━━━━━━━━━━━━\nTo access the server, please verify your Minecraft account.\n\nClick the **VERIFY NOW** button in the #${VERIFY_CHANNEL_NAME} channel to start.`);
    } catch(e) {}
    lastReminder[member.id] = Date.now();
    saveData();
});

// ==================== INTERACTION HANDLER ====================
client.on('interactionCreate', async interaction => {
    // BUTTON HANDLER
    if (interaction.isButton() && interaction.customId === 'verify_button') {
        console.log(`🔘 Button clicked by ${interaction.user.tag}`);
        try {
            const roles = await setupRoles(interaction.guild);
            if (interaction.member.roles.cache.has(roles.verified.id)) {
                return interaction.reply({ content: '❌ You are already verified!', ephemeral: true });
            }
            await showVerificationModal(interaction);
        } catch (error) {
            console.error('Button error:', error);
            await interaction.reply({ content: '❌ Something went wrong. Try again.', ephemeral: true });
        }
        return;
    }
    
    // MODAL HANDLER
    if (interaction.isModalSubmit() && interaction.customId === 'verificationModal') {
        console.log(`📝 Modal submitted by ${interaction.user.tag}`);
        try {
            const username = interaction.fields.getTextInputValue('username');
            const edition = interaction.fields.getSelectMenuValue('edition');
            const device = interaction.fields.getSelectMenuValue('device');
            const region = interaction.fields.getSelectMenuValue('region');
            
            await interaction.deferReply({ ephemeral: true });
            const result = await verifyMember(interaction.member, username, edition, device, region);
            await interaction.editReply({ content: result.message });
        } catch (error) {
            console.error('Modal error:', error);
            await interaction.reply({ content: '❌ Verification failed. Try again.', ephemeral: true });
        }
        return;
    }
    
    // COMMAND HANDLER
    if (!interaction.isCommand()) return;
    
    const { commandName, options, member, channel, guild } = interaction;
    const isStaff = member.permissions.has('Administrator') || member.roles.cache.some(r => ['Staff', 'Mod', 'Admin'].includes(r.name));
    
    if (commandName === 'sendverify' && isStaff) {
        if (channel.name !== VERIFY_CHANNEL_NAME) {
            return interaction.reply({ content: `❌ Use this in #${VERIFY_CHANNEL_NAME}`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await sendVerifyMessage(channel);
        await interaction.editReply({ content: '✅ Verification button sent!' });
    }
    else if (commandName === 'notify' && isStaff) {
        await interaction.deferReply({ ephemeral: true });
        const roles = await setupRoles(guild);
        const members = await guild.members.fetch();
        let count = 0;
        
        for (const member of members.values()) {
            if (member.user.bot) continue;
            if (!member.roles.cache.has(roles.verified.id) && member.roles.cache.has(roles.unverified.id)) {
                try {
                    await member.send(`**🔐 ${guild.name} - Verification Required**\n━━━━━━━━━━━━━━━━━━━━\nTo access the server, please verify your Minecraft account.\n\nClick the **VERIFY NOW** button in <#${channel.id}> to start.\n━━━━━━━━━━━━━━━━━━━━\nYou will need:\n• Your Minecraft username\n• Your game edition (Java/Bedrock)\n• Your device\n• Your region`);
                    count++;
                    await new Promise(r => setTimeout(r, 1000));
                } catch(e) {
                    console.log(`Could not DM ${member.user.tag}`);
                }
            }
        }
        
        await interaction.editReply({ content: `✅ Sent verification reminders to **${count}** unverified members!` });
        
        if (roles.logChannel) {
            roles.logChannel.send(`📢 **${interaction.user.tag}** sent verification reminders to ${count} members`);
        }
    }
    else if (commandName === 'help' && isStaff) {
        const helpText = `**📋 STAFF COMMANDS**\n━━━━━━━━━━━━━━━━━━━━\n/sendverify - Send verification button\n/notify - Send reminder to all unverified members\n/forceverify @user - Force verify\n/unverify @user - Remove verification\n/checkign @user - Check IGN\n/changedevice @user device - Change device\n/changeregion @user region - Change region\n/changeedition @user edition - Change edition\n━━━━━━━━━━━━━━━━━━━━\nDevices: Mobile, PC, Controller, PlayStation, Switch\nRegions: Asia, Europe, America, Africa, Oceania\nEditions: Java, Bedrock`;
        await interaction.reply({ content: helpText, ephemeral: true });
    }
    else if (commandName === 'forceverify' && isStaff) {
        await showVerificationModal(interaction);
    }
    else if (commandName === 'unverify' && isStaff) {
        const target = options.getMember('member');
        const roles = await setupRoles(interaction.guild);
        
        if (!target.roles.cache.has(roles.verified.id)) {
            return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        }
        
        await target.roles.remove(roles.verified);
        await target.roles.remove(roles.player);
        if (roles.unverified) await target.roles.add(roles.unverified);
        
        for (const role of Object.values(roles)) {
            if (role && target.roles.cache.has(role.id) && role.name !== roles.unverified.name && role.name !== roles.player.name && role.name !== roles.verified.name) {
                await target.roles.remove(role);
            }
        }
        
        try { await target.setNickname(null); } catch(e) {}
        
        const oldIgn = ignData[target.id]?.ign;
        if (oldIgn) delete ignToUser[oldIgn];
        delete ignData[target.id];
        saveData();
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}`, ephemeral: true });
        
        if (roles.logChannel) {
            roles.logChannel.send(`🛠️ ${interaction.user.tag} unverified ${target.user.tag}`);
        }
    }
    else if (commandName === 'checkign' && isStaff) {
        const target = options.getMember('member');
        const data = ignData[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}**\nIGN: ${data.ign}\nEdition: ${data.edition === 'java' ? '☕ Java' : '🟩 Bedrock'}\nDevice: ${DEVICE_ROLES[data.device]?.name}\nRegion: ${REGION_ROLES[data.region]?.name}\nVerified: ${new Date(data.verifiedAt).toLocaleString()}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
    else if (commandName === 'changedevice' && isStaff) {
        const target = options.getMember('member');
        const newDevice = options.getString('device');
        const roles = await setupRoles(interaction.guild);
        const data = ignData[target.id];
        
        if (!data) return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        
        for (const [key, role] of Object.entries(roles)) {
            if (key.startsWith('device_') && target.roles.cache.has(role.id)) {
                await target.roles.remove(role);
            }
        }
        
        const newRoleKey = `device_${newDevice}`;
        if (roles[newRoleKey]) await target.roles.add(roles[newRoleKey]);
        
        data.device = newDevice;
        saveData();
        
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s device to ${DEVICE_ROLES[newDevice].name}`, ephemeral: true });
    }
    else if (commandName === 'changeregion' && isStaff) {
        const target = options.getMember('member');
        const newRegion = options.getString('region');
        const roles = await setupRoles(interaction.guild);
        const data = ignData[target.id];
        
        if (!data) return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        
        for (const [key, role] of Object.entries(roles)) {
            if (key.startsWith('region_') && target.roles.cache.has(role.id)) {
                await target.roles.remove(role);
            }
        }
        
        const newRoleKey = `region_${newRegion}`;
        if (roles[newRoleKey]) await target.roles.add(roles[newRoleKey]);
        
        data.region = newRegion;
        saveData();
        
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s region to ${REGION_ROLES[newRegion].name}`, ephemeral: true });
    }
    else if (commandName === 'changeedition' && isStaff) {
        const target = options.getMember('member');
        const newEdition = options.getString('edition');
        const roles = await setupRoles(interaction.guild);
        const data = ignData[target.id];
        
        if (!data) return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        
        for (const [key, role] of Object.entries(roles)) {
            if (key.startsWith('edition_') && target.roles.cache.has(role.id)) {
                await target.roles.remove(role);
            }
        }
        
        const newRoleKey = `edition_${newEdition}`;
        if (roles[newRoleKey]) await target.roles.add(roles[newRoleKey]);
        
        data.edition = newEdition;
        saveData();
        
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s edition to ${EDITION_ROLES[newEdition].name}`, ephemeral: true });
    }
    else if (!isStaff && ['sendverify', 'notify', 'forceverify', 'unverify', 'checkign', 'changedevice', 'changeregion', 'changeedition', 'help'].includes(commandName)) {
        await interaction.reply({ content: '❌ Staff only command.', ephemeral: true });
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
});

client.login(TOKEN);