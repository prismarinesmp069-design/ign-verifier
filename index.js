const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
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
const VERIFIED_ROLE_NAME = '🍀 Verified';
const PLAYER_ROLE_NAME = '⚔️ Player';
const UNVERIFIED_ROLE_NAME = '☘️ Unverified';
const CATEGORY_NAME = '🔐 Server Access';
const VERIFY_CHANNEL_NAME = 'verify';
const LOG_CHANNEL_NAME = 'logs';
const REMINDER_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const NICKNAME_STYLE = '✦ ${ign} ✦'; // Style: ✦ Notch ✦

// ==================== DATABASE ====================
const DATA_FILE = 'igns.json';
let ignData = {};      // userId -> { ign, verifiedAt }
let ignToUser = {};    // ign -> userId
let lastReminder = {}; // userId -> timestamp

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
async function checkMinecraftUsername(username) {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!res.ok) return null;
    return await res.json();
}

function formatNickname(ign) {
    return NICKNAME_STYLE.replace('${ign}', ign);
}

async function getRole(guild, name, color, reason) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) {
        role = await guild.roles.create({ name, color, reason });
    }
    return role;
}

async function setupPermissions(guild) {
    // Create category
    let category = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === 4);
    if (!category) {
        category = await guild.channels.create({ name: CATEGORY_NAME, type: 4 });
    }

    // Get or create roles
    const verifiedRole = await getRole(guild, VERIFIED_ROLE_NAME, 0x2ECC71, 'Verified members');
    const playerRole = await getRole(guild, PLAYER_ROLE_NAME, 0xF1C40F, 'Players');
    const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE_NAME, 0x7F8C8D, 'Unverified members');

    // Category permissions
    await category.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
    await category.permissionOverwrites.edit(verifiedRole, { ViewChannel: true });
    await category.permissionOverwrites.edit(playerRole, { ViewChannel: true });
    await category.permissionOverwrites.edit(unverifiedRole, { ViewChannel: false });

    // Create verify channel
    let verifyChannel = guild.channels.cache.find(c => c.name === VERIFY_CHANNEL_NAME);
    if (!verifyChannel) {
        verifyChannel = await guild.channels.create({
            name: VERIFY_CHANNEL_NAME,
            type: 0,
            parent: category.id,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'UseSlashCommands'] },
                { id: verifiedRole.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'UseSlashCommands'] },
                { id: playerRole.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'UseSlashCommands'] },
                { id: unverifiedRole.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'UseSlashCommands'] }
            ]
        });
    }

    // Create logs channel
    let logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
    if (!logChannel) {
        logChannel = await guild.channels.create({
            name: LOG_CHANNEL_NAME,
            type: 0,
            parent: category.id,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
                { id: verifiedRole.id, allow: ['ViewChannel', 'ReadMessageHistory'] },
                { id: playerRole.id, allow: ['ViewChannel', 'ReadMessageHistory'] }
            ]
        });
    }

    return { verifiedRole, playerRole, unverifiedRole, logChannel };
}

async function verifyMember(member, ign, staffOverride = false, staffMember = null) {
    const guild = member.guild;
    const { verifiedRole, playerRole, unverifiedRole, logChannel } = await setupPermissions(guild);

    if (member.roles.cache.has(verifiedRole.id)) {
        return { success: false, message: '❌ You are already verified!' };
    }

    if (!/^[a-zA-Z0-9_]{3,16}$/.test(ign)) {
        return { success: false, message: '❌ Invalid IGN. Use 3-16 letters, numbers, or underscores.' };
    }

    if (!staffOverride) {
        const mojang = await checkMinecraftUsername(ign);
        if (!mojang) {
            return { success: false, message: '❌ That Minecraft username does not exist.' };
        }
        ign = mojang.name;
    }

    if (ignToUser[ign] && ignToUser[ign] !== member.id) {
        return { success: false, message: '❌ This IGN is already verified by another member.' };
    }

    const formattedNick = formatNickname(ign);
    try {
        await member.setNickname(formattedNick);
    } catch(e) {
        return { success: false, message: '❌ Failed to set nickname. Bot role needs to be higher.' };
    }

    await member.roles.remove(unverifiedRole);
    await member.roles.add(verifiedRole);
    await member.roles.add(playerRole);

    ignData[member.id] = { ign, verifiedAt: new Date().toISOString() };
    ignToUser[ign] = member.id;
    delete lastReminder[member.id];
    saveData();

    if (logChannel) {
        logChannel.send(`✅ **${member.user.tag}** verified as **${ign}** ${staffOverride ? '(by staff)' : ''}`);
    }

    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\nYour IGN: **${ign}**\nNickname: \`${formattedNick}\`\nYou now have access to all channels.`);
    } catch(e) {}

    return { success: true, message: `✅ Verified as **${ign}**!` };
}

// ==================== COMMAND REGISTRATION ====================
async function registerCommands() {
    const commands = [
        { name: 'verify', description: 'Verify your Minecraft username', options: [{ name: 'ign', type: 3, required: true, description: 'Your Minecraft IGN' }] },
        { name: 'forceverify', description: '[Staff] Force verify a member', options: [{ name: 'member', type: 6, required: true }, { name: 'ign', type: 3, required: true }] },
        { name: 'unverify', description: '[Staff] Remove verification', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'checkign', description: '[Staff] Check member IGN', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'setnickname', description: '[Staff] Change member nickname', options: [{ name: 'member', type: 6, required: true }, { name: 'nickname', type: 3, required: true }] }
    ];
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

// ==================== REMINDER SYSTEM ====================
async function sendReminders(guild) {
    const verifiedRole = guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
    if (!verifiedRole) return;
    
    const members = await guild.members.fetch();
    const now = Date.now();
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(verifiedRole.id)) continue;
        
        const last = lastReminder[member.id] || 0;
        if (now - last >= REMINDER_INTERVAL_MS) {
            try {
                await member.send(`**Reminder:** Verify your Minecraft IGN with \`/verify YourIGN\` in #verify to access ${guild.name}.`);
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
    
    await setupPermissions(guild);
    await registerCommands();
    
    const { verifiedRole, unverifiedRole } = await setupPermissions(guild);
    const members = await guild.members.fetch();
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (!member.roles.cache.has(verifiedRole.id) && !member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.add(unverifiedRole);
        }
        if (!member.roles.cache.has(verifiedRole.id) && !ignData[member.id]) {
            try {
                await member.send(`Welcome! Verify your IGN using \`/verify YourIGN\` in #verify.`);
                lastReminder[member.id] = Date.now();
            } catch(e) {}
        }
    }
    saveData();
    
    setInterval(() => sendReminders(guild), 60 * 1000);
    console.log('✅ Ready');
});

client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    const unverifiedRole = member.guild.roles.cache.find(r => r.name === UNVERIFIED_ROLE_NAME);
    if (unverifiedRole) await member.roles.add(unverifiedRole);
    try {
        await member.send(`**Welcome!** Verify your Minecraft IGN with \`/verify YourIGN\` in #verify.`);
    } catch(e) {}
    lastReminder[member.id] = Date.now();
    saveData();
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (oldMember.nickname === newMember.nickname) return;
    if (newMember.user.bot) return;
    
    const verifiedRole = newMember.guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
    if (!verifiedRole || !newMember.roles.cache.has(verifiedRole.id)) return;
    
    const stored = ignData[newMember.id]?.ign;
    if (stored) {
        const expectedNick = formatNickname(stored);
        if (expectedNick !== newMember.nickname) {
            try {
                await newMember.setNickname(expectedNick);
                const logChannel = newMember.guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
                if (logChannel) logChannel.send(`⚠️ **${newMember.user.tag}** tried to change nickname. Reverted.`);
            } catch(e) {}
        }
    }
});

// ==================== COMMAND HANDLERS ====================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, member, guild } = interaction;
    
    const isStaff = member.permissions.has('Administrator') || member.roles.cache.some(r => ['Staff', 'Mod', 'Admin'].includes(r.name));

    if (commandName === 'verify') {
        const ign = options.getString('ign');
        await interaction.deferReply({ ephemeral: true });
        const result = await verifyMember(member, ign, false);
        await interaction.editReply({ content: result.message });
    }
    else if (commandName === 'forceverify' && isStaff) {
        const target = options.getMember('member');
        const ign = options.getString('ign');
        await interaction.deferReply({ ephemeral: true });
        const result = await verifyMember(target, ign, true, interaction.user);
        await interaction.editReply({ content: result.message });
    }
    else if (commandName === 'unverify' && isStaff) {
        const target = options.getMember('member');
        const verifiedRole = guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
        const playerRole = guild.roles.cache.find(r => r.name === PLAYER_ROLE_NAME);
        const unverifiedRole = guild.roles.cache.find(r => r.name === UNVERIFIED_ROLE_NAME);
        
        if (!target.roles.cache.has(verifiedRole?.id)) {
            return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        }
        await target.roles.remove(verifiedRole);
        await target.roles.remove(playerRole);
        if (unverifiedRole) await target.roles.add(unverifiedRole);
        try { await target.setNickname(null); } catch(e) {}
        
        const oldIgn = ignData[target.id]?.ign;
        if (oldIgn) delete ignToUser[oldIgn];
        delete ignData[target.id];
        saveData();
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}.`, ephemeral: true });
        
        const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
        if (logChannel) logChannel.send(`🛠️ **${interaction.user.tag}** unverified **${target.user.tag}**`);
    }
    else if (commandName === 'checkign' && isStaff) {
        const target = options.getMember('member');
        const data = ignData[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}** : IGN = \`${data.ign}\``, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
    else if (commandName === 'setnickname' && isStaff) {
        const target = options.getMember('member');
        const newNick = options.getString('nickname');
        try {
            await target.setNickname(newNick);
            await interaction.reply({ content: `✅ Changed nickname to \`${newNick}\``, ephemeral: true });
            const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
            if (logChannel) logChannel.send(`🛠️ **${interaction.user.tag}** changed ${target.user.tag}'s nickname to \`${newNick}\``);
        } catch(e) {
            await interaction.reply({ content: '❌ Failed to change nickname.', ephemeral: true });
        }
    }
    else if (!isStaff && ['forceverify', 'unverify', 'checkign', 'setnickname'].includes(commandName)) {
        await interaction.reply({ content: '❌ Staff only command.', ephemeral: true });
    }
});

client.login(TOKEN);