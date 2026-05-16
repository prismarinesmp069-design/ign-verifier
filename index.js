const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');

// ==================== KEEP-ALIVE SERVER ====================
const keepAliveApp = express();
keepAliveApp.get('/', (req, res) => res.send('✅ Bot is running!'));
keepAliveApp.listen(3000, () => console.log('🌐 Keep-alive server on port 3000'));

// ==================== DISCORD CLIENT ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// ==================== CONFIGURATION ====================
const TOKEN = process.env.IGN_TOKEN;
const CLIENT_ID = process.env.IGN_CLIENT_ID;
const GUILD_ID = process.env.IGN_GUILD_ID;

const VERIFIED_ROLE = '✅ Verified';
const PLAYER_ROLE = '⚔️ Player';
const UNVERIFIED_ROLE = '☘️ Unverified';
const VERIFY_CHANNEL = 'verify';
const REMINDER_INTERVAL = 60 * 60 * 1000; // 1 hour

const EDITIONS = {
    'java': { name: '☕ Java Edition', color: 0xE67E22 },
    'bedrock': { name: '🟩 Bedrock Edition', color: 0x2ECC71 }
};

const DEVICES = {
    'mobile': { name: '📱 Mobile', color: 0x3498DB },
    'pc': { name: '🖥 PC', color: 0x9B59B6 },
    'controller': { name: '🎮 Controller', color: 0xE91E63 },
    'playstation': { name: '🟦 PlayStation', color: 0x1ABC9C },
    'switch': { name: '🔴 Switch', color: 0xE74C3C }
};

const REGIONS = {
    'asia': { name: '🌏 Asia', color: 0xF39C12 },
    'europe': { name: '🌍 Europe', color: 0x2ECC71 },
    'america': { name: '🌎 America', color: 0x3498DB },
    'africa': { name: '🌍 Africa', color: 0xE67E22 },
    'oceania': { name: '🌏 Oceania', color: 0x1ABC9C }
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

// ==================== ROLE MANAGEMENT ====================
async function getOrCreateRole(guild, name, color) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) {
        try {
            role = await guild.roles.create({ name, color, reason: 'Auto-created by verification bot' });
            console.log(`✅ Created role: ${name}`);
        } catch(e) { console.error(`Failed to create role ${name}:`, e.message); }
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
async function verifyJavaIGN(username) {
    try {
        const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
        if (!res.ok) return null;
        const data = await res.json();
        return { valid: true, username: data.name, uuid: data.id };
    } catch(e) { return null; }
}

async function verifyBedrockIGN(username) {
    if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) return null;
    return { valid: true, username: username };
}

// ==================== VERIFICATION ====================
async function verifyUser(member, data) {
    const { username, edition, device, region } = data;
    const guild = member.guild;
    const roles = await setupRoles(guild);
    
    // Check if already verified
    if (member.roles.cache.has(roles.verified.id)) {
        return { success: false, message: '❌ You are already verified!' };
    }
    
    // Validate username
    if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) {
        return { success: false, message: '❌ Invalid username. Use 3-16 characters: letters, numbers, underscores, or spaces.' };
    }
    
    // Check for duplicate IGN
    if (db.ignToUser[username.toLowerCase()] && db.ignToUser[username.toLowerCase()] !== member.id) {
        return { success: false, message: '❌ This username is already verified by another member.' };
    }
    
    // Verify with Mojang/Xbox
    let verifiedUsername = username;
    if (edition === 'java') {
        const mojang = await verifyJavaIGN(username);
        if (!mojang) return { success: false, message: '❌ Java username does not exist on Mojang.' };
        verifiedUsername = mojang.username;
    } else {
        const bedrock = await verifyBedrockIGN(username);
        if (!bedrock) return { success: false, message: '❌ Invalid Bedrock username.' };
    }
    
    // Change nickname
    try {
        await member.setNickname(verifiedUsername);
        console.log(`✅ Nickname changed: ${member.user.tag} → ${verifiedUsername}`);
    } catch(e) {
        console.log(`⚠️ Could not change nickname for ${member.user.tag}:`, e.message);
    }
    
    // Remove unverified role
    if (roles.unverified && member.roles.cache.has(roles.unverified.id)) {
        await member.roles.remove(roles.unverified);
    }
    
    // Add roles
    await member.roles.add(roles.verified);
    await member.roles.add(roles.player);
    await member.roles.add(roles[`edition_${edition}`]);
    await member.roles.add(roles[`device_${device}`]);
    await member.roles.add(roles[`region_${region}`]);
    
    // Save to database
    db.users[member.id] = { username: verifiedUsername, edition, device, region, verifiedAt: Date.now() };
    db.ignToUser[verifiedUsername.toLowerCase()] = member.id;
    delete db.lastReminder[member.id];
    saveDB();
    
    // Send welcome DM
    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\n**Minecraft Username:** ${verifiedUsername}\n**Edition:** ${EDITIONS[edition].name}\n**Device:** ${DEVICES[device].name}\n**Region:** ${REGIONS[region].name}\n━━━━━━━━━━━━━━━━━━━━\nYou now have access to all channels.`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${verifiedUsername}**!` };
}

// ==================== COMMANDS ====================
async function registerCommands() {
    const commands = [
        { name: 'verifybtn', description: 'Send verification button (Staff only)' },
        { name: 'notify', description: 'Send reminder to unverified members (Staff only)' },
        { name: 'forceverify', description: 'Force verify a member (Staff only)', options: [{ name: 'member', type: 6, required: true, description: 'Member to verify' }] },
        { name: 'unverify', description: 'Remove verification (Staff only)', options: [{ name: 'member', type: 6, required: true, description: 'Member to unverify' }] },
        { name: 'checkign', description: 'Check member\'s IGN (Staff only)', options: [{ name: 'member', type: 6, required: true, description: 'Member to check' }] }
    ];
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered');
}

// ==================== UI COMPONENTS ====================
async function sendVerifyButton(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🔐 MINECRAFT VERIFICATION')
        .setDescription('Click the button below to verify your Minecraft account.\n\n**You will need:**\n• Your Minecraft username\n• Your game edition (Java/Bedrock)\n• Your device\n• Your region')
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

async function showModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('Minecraft Account Verification');
    
    const usernameInput = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('Minecraft Username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Enter your Minecraft username');
    
    modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
    
    // Add select menus as separate components in follow-up
    await interaction.showModal(modal);
}

// ==================== EVENT HANDLERS ====================
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
    let unverifiedCount = 0;
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (!member.roles.cache.has(roles.verified.id) && !member.roles.cache.has(roles.unverified.id)) {
            await member.roles.add(roles.unverified);
            unverifiedCount++;
        }
    }
    
    console.log(`✅ Ready | ${unverifiedCount} members have ☘️ Unverified role`);
    console.log('📌 Staff: Use /verifybtn in #verify channel');
});

client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    const roles = await setupRoles(member.guild);
    if (!member.roles.cache.has(roles.verified.id) && roles.unverified) {
        await member.roles.add(roles.unverified);
    }
    try {
        await member.send(`**🔐 ${member.guild.name} - Verification Required**\n━━━━━━━━━━━━━━━━━━━━\nPlease verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL}.\n\nYou will need:\n• Your Minecraft username\n• Your game edition (Java/Bedrock)\n• Your device\n• Your region`);
    } catch(e) {}
});

// ==================== INTERACTION HANDLERS ====================
client.on('interactionCreate', async interaction => {
    // BUTTON HANDLER
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        console.log(`🔘 ${interaction.user.tag} clicked verify button`);
        await showModal(interaction);
        return;
    }
    
    // MODAL FIRST STEP - Get username
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        const username = interaction.fields.getTextInputValue('username');
        console.log(`📝 ${interaction.user.tag} entered username: ${username}`);
        
        // Send follow-up with edition, device, region selection
        const editionRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_edition')
                .setPlaceholder('Select your game edition')
                .addOptions([
                    { label: '☕ Java Edition', value: 'java', emoji: '☕' },
                    { label: '🟩 Bedrock Edition', value: 'bedrock', emoji: '🟩' }
                ])
        );
        
        const deviceRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_device')
                .setPlaceholder('Select your device')
                .addOptions(Object.entries(DEVICES).map(([val, data]) => ({ label: data.name, value: val })))
        );
        
        const regionRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_region')
                .setPlaceholder('Select your region')
                .addOptions(Object.entries(REGIONS).map(([val, data]) => ({ label: data.name, value: val })))
        );
        
        // Store username temporarily
        interaction.client.tempUsername = username;
        
        await interaction.reply({
            content: `**Minecraft Username:** \`${username}\`\n\nPlease select your game edition, device, and region:`,
            components: [editionRow, deviceRow, regionRow],
            ephemeral: true
        });
        return;
    }
    
    // SELECT MENU HANDLER - Collect edition, device, region
    if (interaction.isStringSelectMenu()) {
        const username = interaction.client.tempUsername;
        if (!username) {
            await interaction.reply({ content: '❌ Session expired. Please click the verify button again.', ephemeral: true });
            return;
        }
        
        let edition, device, region;
        
        if (interaction.customId === 'select_edition') {
            edition = interaction.values[0];
            // Store partial data
            interaction.client.tempEdition = edition;
            await interaction.reply({ content: `✅ Edition selected: ${EDITIONS[edition].name}\n\nNow select your device and region from the menus below.`, ephemeral: true });
        }
        else if (interaction.customId === 'select_device') {
            device = interaction.values[0];
            interaction.client.tempDevice = device;
            await interaction.reply({ content: `✅ Device selected: ${DEVICES[device].name}`, ephemeral: true });
        }
        else if (interaction.customId === 'select_region') {
            region = interaction.values[0];
            interaction.client.tempRegion = region;
            await interaction.reply({ content: `✅ Region selected: ${REGIONS[region].name}`, ephemeral: true });
        }
        
        // If all selections are made, proceed with verification
        edition = interaction.client.tempEdition;
        device = interaction.client.tempDevice;
        region = interaction.client.tempRegion;
        
        if (edition && device && region) {
            await interaction.deferReply({ ephemeral: true });
            const result = await verifyUser(interaction.member, { username, edition, device, region });
            await interaction.editReply({ content: result.message });
            
            // Clean up temp data
            delete interaction.client.tempUsername;
            delete interaction.client.tempEdition;
            delete interaction.client.tempDevice;
            delete interaction.client.tempRegion;
        }
        return;
    }
    
    // COMMAND HANDLER
    if (!interaction.isCommand()) return;
    
    const { commandName, member, channel } = interaction;
    const isStaff = member.permissions.has('Administrator');
    
    if (!isStaff && commandName !== 'verifybtn') {
        return interaction.reply({ content: '❌ Staff only command.', ephemeral: true });
    }
    
    if (commandName === 'verifybtn' && isStaff) {
        if (channel.name !== VERIFY_CHANNEL) {
            return interaction.reply({ content: `❌ Use this command in #${VERIFY_CHANNEL}`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await sendVerifyButton(channel);
        await interaction.editReply({ content: '✅ Verification button sent!' });
    }
    else if (commandName === 'notify' && isStaff) {
        await interaction.deferReply({ ephemeral: true });
        const roles = await setupRoles(interaction.guild);
        const members = await interaction.guild.members.fetch();
        let count = 0;
        
        for (const m of members.values()) {
            if (m.user.bot) continue;
            if (!m.roles.cache.has(roles.verified.id) && m.roles.cache.has(roles.unverified.id)) {
                try {
                    await m.send(`**🔐 Verification Required**\nPlease verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL}.`);
                    count++;
                    await new Promise(r => setTimeout(r, 500));
                } catch(e) {}
            }
        }
        await interaction.editReply({ content: `✅ Sent reminders to ${count} unverified members.` });
    }
    else if (commandName === 'forceverify' && isStaff) {
        const target = interaction.options.getMember('member');
        interaction.client.forceTarget = target.id;
        await showModal(interaction);
    }
    else if (commandName === 'unverify' && isStaff) {
        const target = interaction.options.getMember('member');
        const roles = await setupRoles(interaction.guild);
        
        if (!target.roles.cache.has(roles.verified.id)) {
            return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        }
        
        await target.roles.remove(roles.verified);
        await target.roles.remove(roles.player);
        if (roles.unverified) await target.roles.add(roles.unverified);
        
        for (const role of Object.values(roles)) {
            if (role && target.roles.cache.has(role.id) && ![roles.unverified.name, roles.player.name, roles.verified.name].includes(role.name)) {
                await target.roles.remove(role);
            }
        }
        
        try { await target.setNickname(null); } catch(e) {}
        
        const oldIgn = db.users[target.id]?.username;
        if (oldIgn) delete db.ignToUser[oldIgn.toLowerCase()];
        delete db.users[target.id];
        saveDB();
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}`, ephemeral: true });
    }
    else if (commandName === 'checkign' && isStaff) {
        const target = interaction.options.getMember('member');
        const data = db.users[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}**\nIGN: ${data.username}\nEdition: ${EDITIONS[data.edition]?.name}\nDevice: ${DEVICES[data.device]?.name}\nRegion: ${REGIONS[data.region]?.name}\nVerified: ${new Date(data.verifiedAt).toLocaleString()}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', (error) => console.error('❌ Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('❌ Uncaught exception:', error));

client.login(TOKEN);