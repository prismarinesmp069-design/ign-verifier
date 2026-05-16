const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');

// ==================== KEEP-ALIVE SERVER ====================
const keepAliveApp = express();
keepAliveApp.get('/', (req, res) => res.send('✅ IGN Verifier Bot is running!'));
keepAliveApp.listen(3000, () => console.log('🌐 Keep-alive server on port 3000'));

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
const VERIFIED_ROLE = '✅ Verified';
const PLAYER_ROLE = '⚔️ Player';
const UNVERIFIED_ROLE = '☘️ Unverified';
const VERIFY_CHANNEL = 'verify';
const LOG_CHANNEL = 'logs';
const REMINDER_INTERVAL = 60 * 60 * 1000; // 1 hour

const EDITIONS = {
    'java': { name: '☕ Java Edition', emoji: '☕', color: 0xE67E22 },
    'bedrock': { name: '🟩 Bedrock Edition', emoji: '🟩', color: 0x2ECC71 }
};

const DEVICES = {
    'mobile': { name: '📱 Mobile', emoji: '📱', color: 0x3498DB },
    'pc': { name: '🖥 PC', emoji: '🖥', color: 0x9B59B6 },
    'controller': { name: '🎮 Controller', emoji: '🎮', color: 0xE91E63 },
    'playstation': { name: '🟦 PlayStation', emoji: '🟦', color: 0x1ABC9C },
    'switch': { name: '🔴 Switch', emoji: '🔴', color: 0xE74C3C }
};

const REGIONS = {
    'asia': { name: '🌏 Asia', emoji: '🌏', color: 0xF39C12 },
    'europe': { name: '🌍 Europe', emoji: '🌍', color: 0x2ECC71 },
    'america': { name: '🌎 America', emoji: '🌎', color: 0x3498DB },
    'africa': { name: '🌍 Africa', emoji: '🌍', color: 0xE67E22 },
    'oceania': { name: '🌏 Oceania', emoji: '🌏', color: 0x1ABC9C }
};

// ==================== DATABASE ====================
const DATA_FILE = 'verification.json';
let db = { users: {}, ignToUser: {}, lastReminder: {} };

if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e) {}
}

function saveDB() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ==================== ROLE HELPERS ====================
async function getOrCreateRole(guild, name, color) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) {
        try {
            role = await guild.roles.create({ name, color, reason: 'Verification bot' });
            console.log(`✅ Created role: ${name}`);
        } catch(e) { console.error(`Failed to create ${name}:`, e.message); }
    }
    return role;
}

async function setupRoles(guild) {
    const roles = {};
    roles.verified = await getOrCreateRole(guild, VERIFIED_ROLE, 0x2ECC71);
    roles.player = await getOrCreateRole(guild, PLAYER_ROLE, 0xF1C40F);
    roles.unverified = await getOrCreateRole(guild, UNVERIFIED_ROLE, 0x7F8C8D);
    
    for (const [key, data] of Object.entries(EDITIONS)) {
        roles[`edition_${key}`] = await getOrCreateRole(guild, data.name, data.color);
    }
    for (const [key, data] of Object.entries(DEVICES)) {
        roles[`device_${key}`] = await getOrCreateRole(guild, data.name, data.color);
    }
    for (const [key, data] of Object.entries(REGIONS)) {
        roles[`region_${key}`] = await getOrCreateRole(guild, data.name, data.color);
    }
    return roles;
}

// ==================== MOJANG API ====================
async function checkJavaUsername(username) {
    try {
        const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.name;
    } catch(e) { return null; }
}

async function checkBedrockUsername(username) {
    if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) return null;
    return username;
}

// ==================== VERIFICATION MODAL ====================
async function showVerificationModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('verify_modal')
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
        .addOptions(Object.entries(EDITIONS).map(([val, data]) => ({ label: data.name, value: val, emoji: data.emoji })));
    
    const deviceSelect = new StringSelectMenuBuilder()
        .setCustomId('device')
        .setPlaceholder('Select your device')
        .addOptions(Object.entries(DEVICES).map(([val, data]) => ({ label: data.name, value: val, emoji: data.emoji })));
    
    const regionSelect = new StringSelectMenuBuilder()
        .setCustomId('region')
        .setPlaceholder('Select your region')
        .addOptions(Object.entries(REGIONS).map(([val, data]) => ({ label: data.name, value: val, emoji: data.emoji })));
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(usernameInput),
        new ActionRowBuilder().addComponents(editionSelect),
        new ActionRowBuilder().addComponents(deviceSelect),
        new ActionRowBuilder().addComponents(regionSelect)
    );
    
    await interaction.showModal(modal);
}

// ==================== VERIFY MEMBER ====================
async function verifyMember(member, username, edition, device, region, staffOverride = false) {
    const guild = member.guild;
    const roles = await setupRoles(guild);
    
    if (member.roles.cache.has(roles.verified.id)) {
        return { success: false, message: '❌ You are already verified!' };
    }
    
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        return { success: false, message: '❌ Invalid username. Use 3-16 letters, numbers, or underscores.' };
    }
    
    if (db.ignToUser[username.toLowerCase()] && db.ignToUser[username.toLowerCase()] !== member.id) {
        return { success: false, message: '❌ This username is already verified by another member.' };
    }
    
    let finalUsername = username;
    if (!staffOverride) {
        if (edition === 'java') {
            const mojangName = await checkJavaUsername(username);
            if (!mojangName) {
                return { success: false, message: '❌ Java username does not exist on Mojang.' };
            }
            finalUsername = mojangName;
        } else {
            const bedrockName = await checkBedrockUsername(username);
            if (!bedrockName) {
                return { success: false, message: '❌ Invalid Bedrock username.' };
            }
        }
    }
    
    try {
        await member.setNickname(finalUsername);
    } catch(e) {
        console.log(`Could not change nickname for ${member.user.tag}:`, e.message);
    }
    
    if (roles.unverified && member.roles.cache.has(roles.unverified.id)) {
        await member.roles.remove(roles.unverified);
    }
    
    await member.roles.add(roles.verified);
    await member.roles.add(roles.player);
    await member.roles.add(roles[`edition_${edition}`]);
    await member.roles.add(roles[`device_${device}`]);
    await member.roles.add(roles[`region_${region}`]);
    
    db.users[member.id] = { username: finalUsername, edition, device, region, verifiedAt: Date.now() };
    db.ignToUser[finalUsername.toLowerCase()] = member.id;
    delete db.lastReminder[member.id];
    saveDB();
    
    const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL);
    if (logChannel) {
        logChannel.send(`✅ **${member.user.tag}** verified as **${finalUsername}** (${EDITIONS[edition].name} | ${DEVICES[device].name} | ${REGIONS[region].name})`);
    }
    
    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\n**Minecraft Username:** ${finalUsername}\n**Edition:** ${EDITIONS[edition].name}\n**Device:** ${DEVICES[device].name}\n**Region:** ${REGIONS[region].name}\n━━━━━━━━━━━━━━━━━━━━\nYou now have access to all channels.`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${finalUsername}**! You now have access to all channels.` };
}

// ==================== SEND VERIFY BUTTON ====================
async function sendVerifyMessage(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🔐 MINECRAFT VERIFICATION')
        .setDescription('━━━━━━━━━━━━━━━━━━━━\nClick the button below to verify your Minecraft account.\n\n**You will need:**\n• Your Minecraft username\n• Your game edition (Java/Bedrock)\n• Your device\n• Your region\n━━━━━━━━━━━━━━━━━━━━')
        .setColor(0x2ECC71)
        .setFooter({ text: 'Verification is required to access the server' });
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_btn')
            .setLabel('✅ VERIFY NOW')
            .setStyle(ButtonStyle.Success)
    );
    
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await msg.pin().catch(() => {});
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
        
        const last = db.lastReminder[member.id] || 0;
        if (now - last >= REMINDER_INTERVAL) {
            try {
                await member.send(`**Reminder:** Verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL} to access ${guild.name}.`);
                db.lastReminder[member.id] = now;
                saveDB();
            } catch(e) {}
        }
    }
}

// ==================== COMMANDS ====================
async function registerCommands() {
    const commands = [
        { name: 'sendverify', description: '[Staff] Send verification button' },
        { name: 'notify', description: '[Staff] Send reminder to all unverified members' },
        { name: 'help', description: '[Staff] Show all commands' },
        { name: 'forceverify', description: '[Staff] Force verify a member', options: [{ name: 'member', type: 6, required: true, description: 'Member to verify' }] },
        { name: 'unverify', description: '[Staff] Remove verification', options: [{ name: 'member', type: 6, required: true, description: 'Member to unverify' }] },
        { name: 'checkign', description: '[Staff] Check member IGN', options: [{ name: 'member', type: 6, required: true, description: 'Member to check' }] },
        { name: 'changedevice', description: '[Staff] Change member device', options: [{ name: 'member', type: 6, required: true, description: 'Member to change' }, { name: 'device', type: 3, required: true, description: 'New device', choices: Object.entries(DEVICES).map(([val, data]) => ({ name: data.name, value: val })) }] },
        { name: 'changeregion', description: '[Staff] Change member region', options: [{ name: 'member', type: 6, required: true, description: 'Member to change' }, { name: 'region', type: 3, required: true, description: 'New region', choices: Object.entries(REGIONS).map(([val, data]) => ({ name: data.name, value: val })) }] },
        { name: 'changeedition', description: '[Staff] Change member edition', options: [{ name: 'member', type: 6, required: true, description: 'Member to change' }, { name: 'edition', type: 3, required: true, description: 'New edition', choices: Object.entries(EDITIONS).map(([val, data]) => ({ name: data.name, value: val })) }] }
    ];
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered');
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
    let notified = 0;
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (!member.roles.cache.has(roles.verified.id) && !member.roles.cache.has(roles.unverified.id)) {
            await member.roles.add(roles.unverified);
            count++;
        }
        if (!member.roles.cache.has(roles.verified.id) && !db.users[member.id]) {
            try {
                await member.send(`**🔐 ${guild.name} - Verification Required**\n━━━━━━━━━━━━━━━━━━━━\nTo access the server, verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL}.\n\nYou will need:\n• Your Minecraft username\n• Your game edition\n• Your device\n• Your region`);
                notified++;
                db.lastReminder[member.id] = Date.now();
            } catch(e) {}
        }
    }
    saveDB();
    
    console.log(`✅ Ready | Gave ☘️ Unverified to ${count} members`);
    console.log(`📨 Sent verification DM to ${notified} existing members`);
    console.log('📌 Staff commands: /sendverify, /notify, /help, /forceverify, /unverify, /checkign, /changedevice, /changeregion, /changeedition');
    
    setInterval(() => sendReminders(guild), 60 * 1000);
});

client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    const roles = await setupRoles(member.guild);
    if (!member.roles.cache.has(roles.verified.id) && roles.unverified) {
        await member.roles.add(roles.unverified);
    }
    try {
        await member.send(`**🔐 ${member.guild.name} - Verification Required**\n━━━━━━━━━━━━━━━━━━━━\nPlease verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL}.`);
    } catch(e) {}
    db.lastReminder[member.id] = Date.now();
    saveDB();
});

// ==================== INTERACTION HANDLER ====================
client.on('interactionCreate', async interaction => {
    // BUTTON HANDLER
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        console.log(`🔘 ${interaction.user.tag} clicked verify button`);
        const roles = await setupRoles(interaction.guild);
        if (interaction.member.roles.cache.has(roles.verified.id)) {
            return interaction.reply({ content: '❌ You are already verified!', ephemeral: true });
        }
        await showVerificationModal(interaction);
        return;
    }
    
    // MODAL HANDLER
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        console.log(`📝 ${interaction.user.tag} submitted verification`);
        
        const username = interaction.fields.getTextInputValue('username');
        const edition = interaction.fields.getSelectMenuValue('edition');
        const device = interaction.fields.getSelectMenuValue('device');
        const region = interaction.fields.getSelectMenuValue('region');
        
        await interaction.deferReply({ ephemeral: true });
        const result = await verifyMember(interaction.member, username, edition, device, region);
        await interaction.editReply({ content: result.message });
        return;
    }
    
    // COMMAND HANDLER
    if (!interaction.isCommand()) return;
    
    const { commandName, options, member, channel, guild } = interaction;
    const isStaff = member.permissions.has('Administrator');
    
    if (!isStaff) {
        return interaction.reply({ content: '❌ Staff only command.', ephemeral: true });
    }
    
    // /sendverify
    if (commandName === 'sendverify') {
        if (channel.name !== VERIFY_CHANNEL) {
            return interaction.reply({ content: `❌ Use this in #${VERIFY_CHANNEL}`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await sendVerifyMessage(channel);
        await interaction.editReply({ content: '✅ Verification button sent!' });
    }
    // /notify
    else if (commandName === 'notify') {
        await interaction.deferReply({ ephemeral: true });
        const roles = await setupRoles(guild);
        const members = await guild.members.fetch();
        let count = 0;
        
        for (const m of members.values()) {
            if (m.user.bot) continue;
            if (!m.roles.cache.has(roles.verified.id) && m.roles.cache.has(roles.unverified.id)) {
                try {
                    await m.send(`**🔐 ${guild.name} - Verification Required**\n━━━━━━━━━━━━━━━━━━━━\nPlease verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL}.`);
                    count++;
                    await new Promise(r => setTimeout(r, 500));
                } catch(e) {}
            }
        }
        await interaction.editReply({ content: `✅ Sent reminders to ${count} unverified members.` });
    }
    // /help
    else if (commandName === 'help') {
        const helpText = `**📋 STAFF COMMANDS**\n━━━━━━━━━━━━━━━━━━━━\n**/sendverify** - Send verification button in #verify\n**/notify** - Send DM reminder to all unverified members\n**/forceverify @user** - Force verify a member\n**/unverify @user** - Remove verification\n**/checkign @user** - Check member's IGN\n**/changedevice @user device** - Change member's device\n**/changeregion @user region** - Change member's region\n**/changeedition @user edition** - Change member's edition\n━━━━━━━━━━━━━━━━━━━━\n**Devices:** ${Object.values(DEVICES).map(d => d.name).join(', ')}\n**Regions:** ${Object.values(REGIONS).map(r => r.name).join(', ')}\n**Editions:** ${Object.values(EDITIONS).map(e => e.name).join(', ')}`;
        await interaction.reply({ content: helpText, ephemeral: true });
    }
    // /forceverify
    else if (commandName === 'forceverify') {
        const target = options.getMember('member');
        await showVerificationModal(interaction);
        interaction.client.forceTarget = target.id;
    }
    // /unverify
    else if (commandName === 'unverify') {
        const target = options.getMember('member');
        const roles = await setupRoles(guild);
        
        if (!target.roles.cache.has(roles.verified.id)) {
            return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        }
        
        await target.roles.remove(roles.verified);
        await target.roles.remove(roles.player);
        if (roles.unverified) await target.roles.add(roles.unverified);
        
        for (const [key, role] of Object.entries(roles)) {
            if (role && target.roles.cache.has(role.id) && !role.name.includes(VERIFIED_ROLE) && !role.name.includes(PLAYER_ROLE) && !role.name.includes(UNVERIFIED_ROLE)) {
                await target.roles.remove(role);
            }
        }
        
        try { await target.setNickname(null); } catch(e) {}
        
        const oldIgn = db.users[target.id]?.username;
        if (oldIgn) delete db.ignToUser[oldIgn.toLowerCase()];
        delete db.users[target.id];
        saveDB();
        
        const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL);
        if (logChannel) logChannel.send(`🛠️ **${interaction.user.tag}** unverified **${target.user.tag}**`);
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}`, ephemeral: true });
    }
    // /checkign
    else if (commandName === 'checkign') {
        const target = options.getMember('member');
        const data = db.users[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}**\n━━━━━━━━━━━━━━━━━━━━\n**IGN:** ${data.username}\n**Edition:** ${EDITIONS[data.edition]?.name}\n**Device:** ${DEVICES[data.device]?.name}\n**Region:** ${REGIONS[data.region]?.name}\n**Verified:** ${new Date(data.verifiedAt).toLocaleString()}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
    // /changedevice
    else if (commandName === 'changedevice') {
        const target = options.getMember('member');
        const newDevice = options.getString('device');
        const roles = await setupRoles(guild);
        const data = db.users[target.id];
        
        if (!data) return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        
        for (const [key, role] of Object.entries(roles)) {
            if (key.startsWith('device_') && target.roles.cache.has(role.id)) {
                await target.roles.remove(role);
            }
        }
        await target.roles.add(roles[`device_${newDevice}`]);
        
        data.device = newDevice;
        saveDB();
        
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s device to ${DEVICES[newDevice].name}`, ephemeral: true });
    }
    // /changeregion
    else if (commandName === 'changeregion') {
        const target = options.getMember('member');
        const newRegion = options.getString('region');
        const roles = await setupRoles(guild);
        const data = db.users[target.id];
        
        if (!data) return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        
        for (const [key, role] of Object.entries(roles)) {
            if (key.startsWith('region_') && target.roles.cache.has(role.id)) {
                await target.roles.remove(role);
            }
        }
        await target.roles.add(roles[`region_${newRegion}`]);
        
        data.region = newRegion;
        saveDB();
        
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s region to ${REGIONS[newRegion].name}`, ephemeral: true });
    }
    // /changeedition
    else if (commandName === 'changeedition') {
        const target = options.getMember('member');
        const newEdition = options.getString('edition');
        const roles = await setupRoles(guild);
        const data = db.users[target.id];
        
        if (!data) return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        
        for (const [key, role] of Object.entries(roles)) {
            if (key.startsWith('edition_') && target.roles.cache.has(role.id)) {
                await target.roles.remove(role);
            }
        }
        await target.roles.add(roles[`edition_${newEdition}`]);
        
        data.edition = newEdition;
        saveDB();
        
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s edition to ${EDITIONS[newEdition].name}`, ephemeral: true });
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', (error) => console.error('❌ Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('❌ Uncaught exception:', error));

client.login(TOKEN);