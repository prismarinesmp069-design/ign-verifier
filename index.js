const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } = require('discord.js');
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

// Nickname style: choose one
// Style 1: "✦ Notch ✦"
// Style 2: "⚔️ Notch"
// Style 3: "Notch" (plain)
const NICKNAME_STYLE = '✦ ${ign} ✦'; // Change to whatever you want

// ==================== DATABASE ====================
const DATA_FILE = 'igns.json';
let ignData = {};
let ignToUser = {};
let lastReminder = {};

if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE);
    const data = JSON.parse(raw);
    ignData = data.ignData || {};
    ignToUser = data.ignToUser || {};
    lastReminder = data.lastReminder || {};
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ ignData, ignToUser, lastReminder }, null, 2));
}

// ==================== HELPER FUNCTIONS ====================
async function checkMinecraftUsername(username) {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { uuid: data.id, name: data.name };
}

function formatNickname(ign) {
    return NICKNAME_STYLE.replace('${ign}', ign);
}

async function getVerifiedRole(guild) {
    let role = guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
    if (!role) {
        role = await guild.roles.create({
            name: VERIFIED_ROLE_NAME,
            color: 0x2ECC71, // Green
            reason: 'Auto-created for verified members'
        });
    }
    return role;
}

async function getPlayerRole(guild) {
    let role = guild.roles.cache.find(r => r.name === PLAYER_ROLE_NAME);
    if (!role) {
        role = await guild.roles.create({
            name: PLAYER_ROLE_NAME,
            color: 0xF1C40F, // Gold
            reason: 'Auto-created for players'
        });
    }
    return role;
}

async function getUnverifiedRole(guild) {
    let role = guild.roles.cache.find(r => r.name === UNVERIFIED_ROLE_NAME);
    if (!role) {
        role = await guild.roles.create({
            name: UNVERIFIED_ROLE_NAME,
            color: 0x7F8C8D, // Gray
            reason: 'Auto-created for unverified members'
        });
    }
    return role;
}

async function setupPermissions(guild) {
    // Create category
    let category = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === 4);
    if (!category) {
        category = await guild.channels.create({ name: CATEGORY_NAME, type: 4 });
    }

    // Get roles
    const verifiedRole = await getVerifiedRole(guild);
    const playerRole = await getPlayerRole(guild);
    const unverifiedRole = await getUnverifiedRole(guild);

    // Category permissions
    await category.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
    await category.permissionOverwrites.edit(verifiedRole, { ViewChannel: true });
    await category.permissionOverwrites.edit(playerRole, { ViewChannel: true });
    await category.permissionOverwrites.edit(unverifiedRole, { ViewChannel: false });

    // Create verify channel (visible to everyone)
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

    // Create logs channel (staff only)
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

    return { category, verifyChannel, logChannel };
}

async function verifyMember(member, ign, staffOverride = false, staffMember = null) {
    const guild = member.guild;
    const verifiedRole = await getVerifiedRole(guild);
    const playerRole = await getPlayerRole(guild);
    const unverifiedRole = await getUnverifiedRole(guild);

    // Check if already verified
    if (member.roles.cache.has(verifiedRole.id)) {
        return { success: false, message: 'Already verified.' };
    }

    // Validate IGN format
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(ign)) {
        return { success: false, message: '❌ Invalid Minecraft username. Use 3-16 letters, numbers, or underscores.' };
    }

    // Check real account
    if (!staffOverride) {
        const mojang = await checkMinecraftUsername(ign);
        if (!mojang) {
            return { success: false, message: '❌ That Minecraft username does not exist. Please check spelling.' };
        }
        ign = mojang.name;
    }

    // Check duplicate IGN
    if (ignToUser[ign] && ignToUser[ign] !== member.id) {
        return { success: false, message: '❌ This Minecraft username is already taken by another member.' };
    }

    // Format nickname
    const formattedNick = formatNickname(ign);
    
    // Change nickname
    try {
        await member.setNickname(formattedNick);
    } catch (e) {
        return { success: false, message: '❌ Failed to change nickname. Bot may need higher role position.' };
    }

    // Remove unverified role, add verified and player roles
    await member.roles.remove(unverifiedRole);
    await member.roles.add(verifiedRole);
    await member.roles.add(playerRole);

    // Save to database
    ignData[member.id] = {
        ign: ign,
        verifiedAt: new Date().toISOString(),
        verifiedBy: staffOverride ? (staffMember ? staffMember.id : 'staff') : 'user'
    };
    ignToUser[ign] = member.id;
    delete lastReminder[member.id];
    saveData();

    // Log to channel
    const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
    if (logChannel) {
        logChannel.send(`✅ **${member.user.tag}** verified as **${ign}** (nickname: ${formattedNick}) ${staffOverride ? '(by staff)' : ''}`);
    }

    // Send welcome DM
    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\nYour Minecraft username has been set to: **${ign}**\nYour nickname: \`${formattedNick}\`\nYou now have access to all channels.\n━━━━━━━━━━━━━━━━━━━━\nEnjoy! 🎮`);
    } catch(e) {}

    return { success: true, message: `✅ Verified as **${ign}** (nickname: ${formattedNick})` };
}

// ==================== COMMAND REGISTRATION ====================
async function registerCommands() {
    const commands = [
        { name: 'verify', description: 'Verify your Minecraft username', options: [{ name: 'ign', type: 3, required: true, description: 'Your Minecraft IGN' }] },
        { name: 'forceverify', description: '[Staff] Force verify a member', options: [{ name: 'member', type: 6, required: true }, { name: 'ign', type: 3, required: true }] },
        { name: 'unverify', description: '[Staff] Remove verification from a member', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'checkign', description: '[Staff] Show stored IGN of a member', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'setnickname', description: '[Staff] Change a member\'s nickname style', options: [{ name: 'member', type: 6, required: true }, { name: 'nickname', type: 3, required: true }] }
    ];
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

// ==================== REMINDER SYSTEM ====================
async function sendReminders(guild) {
    const verifiedRole = await getVerifiedRole(guild);
    const members = await guild.members.fetch();
    const now = Date.now();
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(verifiedRole.id)) continue;
        const last = lastReminder[member.id] || 0;
        if (now - last >= REMINDER_INTERVAL_MS) {
            try {
                await member.send(`**Reminder:** You need to verify your Minecraft username to access ${guild.name}.\nUse \`/verify YourIGN\` in the #verify channel.`);
                lastReminder[member.id] = now;
            } catch(e) {}
        }
    }
    saveData();
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
    
    // Process existing members - give unverified role
    const unverifiedRole = await getUnverifiedRole(guild);
    const verifiedRole = await getVerifiedRole(guild);
    const members = await guild.members.fetch();
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (!member.roles.cache.has(verifiedRole.id) && !member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.add(unverifiedRole);
        }
        if (!member.roles.cache.has(verifiedRole.id) && !ignData[member.id]) {
            try {
                await member.send(`Welcome! Please verify your Minecraft IGN using \`/verify YourIGN\` in the #verify channel.`);
                lastReminder[member.id] = Date.now();
            } catch(e) {}
        }
    }
    saveData();
    
    // Start reminder loop
    setInterval(() => sendReminders(guild), 60 * 1000);
    console.log('✅ Ready');
});

// Auto-assign unverified role on join
client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    const unverifiedRole = await getUnverifiedRole(member.guild);
    await member.roles.add(unverifiedRole);
    try {
        await member.send(`**Welcome to ${member.guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\nTo access the server, verify your Minecraft username using \`/verify YourIGN\` in the #verify channel.\n━━━━━━━━━━━━━━━━━━━━\nYou have unlimited time, but you cannot see other channels until verified.`);
    } catch(e) {}
    lastReminder[member.id] = Date.now();
    saveData();
});

// Prevent nickname changes for verified members
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (oldMember.nickname === newMember.nickname) return;
    if (newMember.user.bot) return;
    const verifiedRole = await getVerifiedRole(newMember.guild);
    if (!newMember.roles.cache.has(verifiedRole.id)) return;
    
    const stored = ignData[newMember.id]?.ign;
    if (stored) {
        const expectedNick = formatNickname(stored);
        if (expectedNick !== newMember.nickname) {
            try {
                await newMember.setNickname(expectedNick);
                const logChannel = newMember.guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
                if (logChannel) logChannel.send(`⚠️ **${newMember.user.tag}** tried to change nickname. Reverted to \`${expectedNick}\`.`);
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
        const verifiedRole = await getVerifiedRole(guild);
        const playerRole = await getPlayerRole(guild);
        const unverifiedRole = await getUnverifiedRole(guild);
        
        if (!target.roles.cache.has(verifiedRole.id)) {
            return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        }
        await target.roles.remove(verifiedRole);
        await target.roles.remove(playerRole);
        await target.roles.add(unverifiedRole);
        try { await target.setNickname(null); } catch(e) {}
        
        const oldIgn = ignData[target.id]?.ign;
        if (oldIgn) delete ignToUser[oldIgn];
        delete ignData[target.id];
        saveData();
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}. They must re-verify.`, ephemeral: true });
        
        const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
        if (logChannel) logChannel.send(`🛠️ **${interaction.user.tag}** unverified **${target.user.tag}**`);
    }
    else if (commandName === 'checkign' && isStaff) {
        const target = options.getMember('member');
        const data = ignData[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}** : Minecraft IGN = \`${data.ign}\` (verified ${new Date(data.verifiedAt).toLocaleString()})`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
    else if (commandName === 'setnickname' && isStaff) {
        const target = options.getMember('member');
        const newNick = options.getString('nickname');
        try {
            await target.setNickname(newNick);
            await interaction.reply({ content: `✅ Changed ${target.user.tag}'s nickname to \`${newNick}\``, ephemeral: true });
            const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL_NAME);
            if (logChannel) logChannel.send(`🛠️ **${interaction.user.tag}** changed ${target.user.tag}'s nickname to \`${newNick}\``);
        } catch(e) {
            await interaction.reply({ content: '❌ Failed to change nickname. Check bot permissions.', ephemeral: true });
        }
    }
    else if (commandName === 'forceverify' && !isStaff || commandName === 'unverify' && !isStaff || commandName === 'checkign' && !isStaff || commandName === 'setnickname' && !isStaff) {
        await interaction.reply({ content: '❌ You need staff permissions to use this command.', ephemeral: true });
    }
});

client.login(TOKEN);
