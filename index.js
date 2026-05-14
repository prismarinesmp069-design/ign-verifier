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

// Configuration
const VERIFIED_ROLE_NAME = '✅ Verified';
const CATEGORY_NAME = '🔐 Server Access';
const VERIFY_CHANNEL_NAME = 'verify';
const REMINDER_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Database file
const DATA_FILE = 'igns.json';
let ignData = {}; // { userId: { ign, verifiedAt, verifiedBy } }
let ignToUser = {}; // { ign: userId }
let lastReminder = {}; // { userId: timestamp }

// Load existing data
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

// Mojang API check
async function checkMinecraftUsername(username) {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { uuid: data.id, name: data.name };
}

// Helper: get verified role
async function getVerifiedRole(guild) {
    let role = guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
    if (!role) {
        role = await guild.roles.create({ name: VERIFIED_ROLE_NAME, color: 0x00FF00, reason: 'Auto-created for verified members' });
    }
    return role;
}

// Setup category & channel permissions
async function setupPermissions(guild) {
    let category = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === 4);
    if (!category) {
        category = await guild.channels.create({ name: CATEGORY_NAME, type: 4 });
    }
    // Deny @everyone view in category
    await category.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
    const verifiedRole = await getVerifiedRole(guild);
    await category.permissionOverwrites.edit(verifiedRole, { ViewChannel: true });

    // Create or get verify channel (outside category or inside with overrides)
    let verifyChannel = guild.channels.cache.find(c => c.name === VERIFY_CHANNEL_NAME);
    if (!verifyChannel) {
        verifyChannel = await guild.channels.create({
            name: VERIFY_CHANNEL_NAME,
            type: 0,
            parent: category.id,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'UseSlashCommands'] },
                { id: verifiedRole.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'UseSlashCommands'] }
            ]
        });
    }
    return { category, verifyChannel };
}

// Verify a member
async function verifyMember(member, ign, staffOverride = false, staffMember = null) {
    const guild = member.guild;
    // Check if already verified
    const verifiedRole = await getVerifiedRole(guild);
    if (member.roles.cache.has(verifiedRole.id)) {
        return { success: false, message: 'Already verified.' };
    }

    // Validate IGN format
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(ign)) {
        return { success: false, message: 'Invalid Minecraft username. Use 3-16 letters, numbers, or underscores.' };
    }

    // Check real account (unless staff override)
    if (!staffOverride) {
        const mojang = await checkMinecraftUsername(ign);
        if (!mojang) {
            return { success: false, message: 'That Minecraft username does not exist. Please check spelling.' };
        }
        // Use the exact casing from Mojang
        ign = mojang.name;
    }

    // Check duplicate IGN
    if (ignToUser[ign] && ignToUser[ign] !== member.id) {
        return { success: false, message: 'This Minecraft username is already taken by another member.' };
    }

    // Change nickname
    try {
        await member.setNickname(ign);
    } catch (e) {
        return { success: false, message: 'Failed to change nickname. Bot may need higher role position.' };
    }

    // Assign verified role
    await member.roles.add(verifiedRole);

    // Save to database
    ignData[member.id] = {
        ign: ign,
        verifiedAt: new Date().toISOString(),
        verifiedBy: staffOverride ? (staffMember ? staffMember.id : 'staff') : 'user'
    };
    ignToUser[ign] = member.id;
    delete lastReminder[member.id];
    saveData();

    // Log
    const logChannel = guild.channels.cache.find(c => c.name === 'logs');
    if (logChannel) {
        logChannel.send(`✅ **${member.user.tag}** verified as **${ign}** ${staffOverride ? '(by staff)' : ''}`);
    }

    // Send DM
    try {
        await member.send(`✅ You have been verified as **${ign}**. You now have access to all channels.`);
    } catch(e) {}

    return { success: true, message: `Verified as **${ign}**.` };
}

// Unverify member
async function unverifyMember(member) {
    const verifiedRole = await getVerifiedRole(member.guild);
    if (!member.roles.cache.has(verifiedRole.id)) {
        return { success: false, message: 'Member not verified.' };
    }
    await member.roles.remove(verifiedRole);
    // Reset nickname to original (or empty)
    try { await member.setNickname(null); } catch(e) {}
    // Remove from database
    const oldIgn = ignData[member.id]?.ign;
    if (oldIgn) delete ignToUser[oldIgn];
    delete ignData[member.id];
    saveData();
    return { success: true, message: `Unverified ${member.user.tag}. They must re-verify.` };
}

// Reminder system
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
            } catch(e) {
                // Can't DM, maybe log
            }
        }
    }
    // Save lastReminder periodically
    saveData();
}

// Command registration
async function registerCommands() {
    const commands = [
        { name: 'verify', description: 'Verify your Minecraft username', options: [{ name: 'ign', type: 3, required: true, description: 'Your Minecraft IGN' }] },
        { name: 'ign', description: 'Change your Minecraft username (staff only)', options: [{ name: 'newign', type: 3, required: true, description: 'New IGN' }] },
        { name: 'forceverify', description: '[Staff] Force verify a member', options: [{ name: 'member', type: 6, required: true }, { name: 'ign', type: 3, required: true }] },
        { name: 'unverify', description: '[Staff] Remove verification from a member', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'checkign', description: '[Staff] Show stored IGN of a member', options: [{ name: 'member', type: 6, required: true }] }
    ];
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

// Event: Bot ready
client.once('ready', async () => {
    console.log(`✅ IGN Verifier logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        console.error('Guild not found! Check GUILD_ID.');
        return;
    }
    await setupPermissions(guild);
    await registerCommands();
    // Process existing members
    const verifiedRole = await getVerifiedRole(guild);
    const members = await guild.members.fetch();
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(verifiedRole.id)) continue;
        // Unverified existing member
        if (!ignData[member.id]) {
            // No record, treat as unverified
            try {
                await member.send(`Welcome! Please verify your Minecraft IGN using \`/verify YourIGN\` in the #verify channel.`);
                lastReminder[member.id] = Date.now();
            } catch(e) {}
        }
    }
    saveData();
    // Start reminder loop every minute
    setInterval(() => sendReminders(guild), 60 * 1000);
    console.log('✅ Ready');
});

// Handle nickname changes (prevent manual changes)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (oldMember.nickname === newMember.nickname) return;
    if (newMember.user.bot) return;
    const verifiedRole = await getVerifiedRole(newMember.guild);
    if (!newMember.roles.cache.has(verifiedRole.id)) return; // not verified, allow?
    // Verified member tried to change nickname – revert
    const stored = ignData[newMember.id]?.ign;
    if (stored && stored !== newMember.nickname) {
        try {
            await newMember.setNickname(stored);
            // Log
            const logChannel = newMember.guild.channels.cache.find(c => c.name === 'logs');
            if (logChannel) logChannel.send(`⚠️ **${newMember.user.tag}** tried to change nickname. Reverted to \`${stored}\`.`);
        } catch(e) {}
    }
});

// Handle new members
client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    try {
        await member.send(`**Welcome to ${member.guild.name}!**\nTo access the server, verify your Minecraft username using \`/verify YourIGN\` in the #verify channel.`);
    } catch(e) {}
    lastReminder[member.id] = Date.now();
    saveData();
});

// Slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, member, guild } = interaction;

    // Helper to check staff (Admin or role named "Staff" or "Mod")
    const isStaff = member.permissions.has('Administrator') || member.roles.cache.some(r => ['Staff', 'Mod', 'Admin'].includes(r.name));

    if (commandName === 'verify') {
        const ign = options.getString('ign');
        const result = await verifyMember(member, ign, false);
        await interaction.reply({ content: result.message, ephemeral: true });
        if (result.success) {
            // Optionally delete the command message from #verify to keep clean
        }
    }
    else if (commandName === 'ign' && isStaff) {
        // Staff-only change IGN
        const newIgn = options.getString('newign');
        const result = await verifyMember(member, newIgn, true, interaction.user);
        await interaction.reply({ content: result.message, ephemeral: true });
    }
    else if (commandName === 'forceverify' && isStaff) {
        const target = options.getMember('member');
        const ign = options.getString('ign');
        const result = await verifyMember(target, ign, true, interaction.user);
        await interaction.reply({ content: result.message, ephemeral: true });
    }
    else if (commandName === 'unverify' && isStaff) {
        const target = options.getMember('member');
        const result = await unverifyMember(target);
        await interaction.reply({ content: result.message, ephemeral: true });
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
    else if (commandName === 'ign' && !isStaff) {
        await interaction.reply({ content: '❌ Only staff can change IGNs. If you need to change yours, contact a moderator.', ephemeral: true });
    }
});

client.login(TOKEN);