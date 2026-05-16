const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');

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
const PLAYER_ROLE_NAME = 'Player ⚔️';
const UNVERIFIED_ROLE_NAME = '☘️ Unverified';
const VERIFY_CHANNEL_NAME = 'verify';
const LOG_CHANNEL_NAME = 'logs';
const REMINDER_INTERVAL_MS = 30 * 60 * 1000;

// Role definitions
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
    if (!/^[a-zA-Z0-9 ]{3,16}$/.test(username)) return null;
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
        {
            name: 'sendverify',
            description: '[Staff] Send verification button message'
        },
        {
            name: 'help',
            description: '[Staff] Show all commands'
        },
        {
            name: 'forceverify',
            description: '[Staff] Force verify a member',
            options: [
                { name: 'member', type: 6, description: 'Member to verify', required: true }
            ]
        },
        {
            name: 'unverify',
            description: '[Staff] Remove verification',
            options: [
                { name: 'member', type: 6, description: 'Member to unverify', required: true }
            ]
        },
        {
            name: 'checkign',
            description: '[Staff] Check member IGN',
            options: [
                { name: 'member', type: 6, description: 'Member to check', required: true }
            ]
        },
        {
            name: 'changedevice',
            description: '[Staff] Change member device',
            options: [
                { name: 'member', type: 6, description: 'Member to change', required: true },
                { name: 'device', type: 3, description: 'New device', required: true, choices: Object.keys(DEVICE_ROLES).map(d => ({ name: DEVICE_ROLES[d].name, value: d })) }
            ]
        },
        {
            name: 'changeregion',
            description: '[Staff] Change member region',
            options: [
                { name: 'member', type: 6, description: 'Member to change', required: true },
                { name: 'region', type: 3, description: 'New region', required: true, choices: Object.keys(REGION_ROLES).map(r => ({ name: REGION_ROLES[r].name, value: r })) }
            ]
        },
        {
            name: 'changeedition',
            description: '[Staff] Change member edition',
            options: [
                { name: 'member', type: 6, description: 'Member to change', required: true },
                { name: 'edition', type: 3, description: 'New edition', required: true, choices: [{ name: 'Java Edition', value: 'java' }, { name: 'Bedrock Edition', value: 'bedrock' }] }
            ]
        }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered');
}

// ==================== SEND VERIFY BUTTON MESSAGE ====================
async function sendVerifyMessage(channel) {
    const embed = {
        title: '🔐 MINECRAFT ACCOUNT VERIFICATION',
        description: `━━━━━━━━━━━━━━━━━━━━\nClick the button below to verify your Minecraft account.\n\n**You will need:**\n• Your Minecraft username\n• Your game edition (Java/Bedrock)\n• Your device\n• Your region\n━━━━━━━━━━━━━━━━━━━━\n**Note:** You must verify in this channel to access the server.`,
        color: 0x2ECC71,
        footer: { text: 'Verification is required to access the server' }
    };
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_button')
            .setLabel('✅ VERIFY NOW')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
    );
    
    const message = await channel.send({ embeds: [embed], components: [row] });
    await message.pin().catch(() => {});
    return message;
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
async function verifyMember(member, ign, edition, device, region, staffOverride = false, staffMember = null) {
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
        roles.logChannel.send(`✅ **${member.user.tag}** verified as **${ign}** (${edition} | ${device} | ${region}) ${staffOverride ? '(by staff)' : ''}`);
    }
    
    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\n**Minecraft Username:** ${ign}\n**Edition:** ${edition === 'java' ? '☕ Java' : '🟩 Bedrock'}\n**Device:** ${DEVICE_ROLES[device].name}\n**Region:** ${REGION_ROLES[region].name}\n━━━━━━━━━━━━━━━━━━━━\nYou now have access to all channels.`);
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

// ==================== EVENT HANDLERS ====================
client.once('ready', async () => {
    console.log(`✅ IGN Verifier logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        console.error('❌ Guild not found! Check GUILD_ID.');
        return;
    }
    
    const roles = await setupRoles(guild);
    await registerCommands();
    
    const members = await guild.members.fetch();
    let existingCount = 0;
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (!member.roles.cache.has(roles.verified.id)) {
            if (!member.roles.cache.has(roles.unverified.id)) {
                await member.roles.add(roles.unverified);
                existingCount++;
            }
            if (!ignData[member.id]) {
                try {
                    await member.send(`**🔐 ${guild.name} - Verification Required**\n━━━━━━━━━━━━━━━━━━━━\nTo regain access to the server, please verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL_NAME}.\n\nYou will need:\n• Your Minecraft username\n• Your game edition\n• Your device\n• Your region\n━━━━━━━━━━━━━━━━━━━━\nClick the "VERIFY NOW" button in #${VERIFY_CHANNEL_NAME} to start.`);
                    lastReminder[member.id] = Date.now();
                } catch(e) {
                    console.log(`Could not DM ${member.user.tag}`);
                }
            }
        }
    }
    saveData();
    console.log(`📊 Processed ${existingCount} existing members - gave them ☘️ Unverified role`);
    
    setInterval(() => sendReminders(guild), 60 * 1000);
    
    console.log('✅ Ready');
    console.log('📌 Use /sendverify in #verify channel to send the verification button');
});

client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    const roles = await setupRoles(member.guild);
    if (!member.roles.cache.has(roles.verified.id) && roles.unverified) {
        await member.roles.add(roles.unverified);
    }
    lastReminder[member.id] = Date.now();
    saveData();
});

// ==================== BUTTON HANDLER ====================
client.on('interactionCreate', async interaction => {
    if (interaction.isButton() && interaction.customId === 'verify_button') {
        const roles = await setupRoles(interaction.guild);
        if (interaction.member.roles.cache.has(roles.verified.id)) {
            return interaction.reply({ content: '❌ You are already verified!', ephemeral: true });
        }
        await showVerificationModal(interaction);
    }
    
    if (interaction.isModalSubmit() && interaction.customId === 'verificationModal') {
        const username = interaction.fields.getTextInputValue('username');
        const edition = interaction.fields.getSelectMenuValue('edition');
        const device = interaction.fields.getSelectMenuValue('device');
        const region = interaction.fields.getSelectMenuValue('region');
        
        await interaction.deferReply({ ephemeral: true });
        const result = await verifyMember(interaction.member, username, edition, device, region, false);
        await interaction.editReply({ content: result.message });
        return;
    }
    
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, member, guild } = interaction;
    const isStaff = member.permissions.has('Administrator') || member.roles.cache.some(r => ['Staff', 'Mod', 'Admin'].includes(r.name));
    
    // /sendverify command (fixed - no timeout)
    if (commandName === 'sendverify' && isStaff) {
        const channel = interaction.channel;
        if (channel.name !== VERIFY_CHANNEL_NAME) {
            return interaction.reply({ content: `❌ Use this command in #${VERIFY_CHANNEL_NAME} channel.`, ephemeral: true });
        }
        // Acknowledge immediately to avoid timeout
        await interaction.deferReply({ ephemeral: true });
        try {
            await sendVerifyMessage(channel);
            await interaction.editReply({ content: '✅ Verification button message sent and pinned!' });
        } catch (error) {
            console.error('Error sending verify message:', error);
            await interaction.editReply({ content: '❌ Failed to send verification message. Check bot permissions.' });
        }
    }
    else if (commandName === 'help' && isStaff) {
        const helpText = `**📋 STAFF COMMANDS**\n━━━━━━━━━━━━━━━━━━━━\n**/sendverify** - Send verification button message in current channel\n**/forceverify @user** - Force verify a member\n**/unverify @user** - Remove verification\n**/checkign @user** - Check member's IGN\n**/changedevice @user device** - Change member's device\n**/changeregion @user region** - Change member's region\n**/changeedition @user edition** - Change member's edition\n━━━━━━━━━━━━━━━━━━━━\n**Available Devices:** ${Object.values(DEVICE_ROLES).map(d => d.name).join(', ')}\n**Available Regions:** ${Object.values(REGION_ROLES).map(r => r.name).join(', ')}\n**Editions:** ☕ Java Edition, 🟩 Bedrock Edition`;
        await interaction.reply({ content: helpText, ephemeral: true });
    }
    else if (commandName === 'forceverify' && isStaff) {
        const target = options.getMember('member');
        interaction.client.forceTarget = target.id;
        await showVerificationModal(interaction);
    }
    else if (commandName === 'unverify' && isStaff) {
        const target = options.getMember('member');
        const roles = await setupRoles(guild);
        
        if (!target.roles.cache.has(roles.verified.id)) {
            return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        }
        
        await target.roles.remove(roles.verified);
        await target.roles.remove(roles.player);
        if (roles.unverified) await target.roles.add(roles.unverified);
        
        for (const role of Object.values(roles)) {
            if (role && target.roles.cache.has(role.id) && 
                role.name !== roles.unverified.name && 
                role.name !== roles.player.name && 
                role.name !== roles.verified.name) {
                await target.roles.remove(role);
            }
        }
        
        try { await target.setNickname(null); } catch(e) {}
        
        const oldIgn = ignData[target.id]?.ign;
        if (oldIgn) delete ignToUser[oldIgn];
        delete ignData[target.id];
        saveData();
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}. They must re-verify in #${VERIFY_CHANNEL_NAME}.`, ephemeral: true });
        
        if (roles.logChannel) {
            roles.logChannel.send(`🛠️ **${interaction.user.tag}** unverified **${target.user.tag}**`);
        }
    }
    else if (commandName === 'checkign' && isStaff) {
        const target = options.getMember('member');
        const data = ignData[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}**\n━━━━━━━━━━━━━━━━━━━━\n**IGN:** ${data.ign}\n**Edition:** ${data.edition === 'java' ? '☕ Java' : '🟩 Bedrock'}\n**Device:** ${DEVICE_ROLES[data.device]?.name || data.device}\n**Region:** ${REGION_ROLES[data.region]?.name || data.region}\n**Verified:** ${new Date(data.verifiedAt).toLocaleString()}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
    else if (commandName === 'changedevice' && isStaff) {
        const target = options.getMember('member');
        const newDevice = options.getString('device');
        const roles = await setupRoles(guild);
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
        
        if (roles.logChannel) {
            roles.logChannel.send(`🛠️ **${interaction.user.tag}** changed ${target.user.tag}'s device to ${DEVICE_ROLES[newDevice].name}`);
        }
    }
    else if (commandName === 'changeregion' && isStaff) {
        const target = options.getMember('member');
        const newRegion = options.getString('region');
        const roles = await setupRoles(guild);
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
        
        if (roles.logChannel) {
            roles.logChannel.send(`🛠️ **${interaction.user.tag}** changed ${target.user.tag}'s region to ${REGION_ROLES[newRegion].name}`);
        }
    }
    else if (commandName === 'changeedition' && isStaff) {
        const target = options.getMember('member');
        const newEdition = options.getString('edition');
        const roles = await setupRoles(guild);
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
        
        if (roles.logChannel) {
            roles.logChannel.send(`🛠️ **${interaction.user.tag}** changed ${target.user.tag}'s edition to ${EDITION_ROLES[newEdition].name}`);
        }
    }
    else if (!isStaff && ['sendverify', 'forceverify', 'unverify', 'checkign', 'changedevice', 'changeregion', 'changeedition', 'help'].includes(commandName)) {
        await interaction.reply({ content: '❌ Staff only command.', ephemeral: true });
    }
});

client.login(TOKEN);