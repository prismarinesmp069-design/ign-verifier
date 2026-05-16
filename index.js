const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const express = require('express');

// Keep-alive server
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(3000, () => console.log('🌐 Server on port 3000'));

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

// Role definitions
const EDITIONS = {
    'java': '☕ Java Edition',
    'bedrock': '🟩 Bedrock Edition'
};

const DEVICES = {
    'mobile': '📱 Mobile',
    'pc': '🖥 PC',
    'controller': '🎮 Controller',
    'playstation': '🟦 PlayStation',
    'switch': '🔴 Switch'
};

const REGIONS = {
    'asia': '🌏 Asia',
    'europe': '🌍 Europe',
    'america': '🌎 America',
    'africa': '🌍 Africa',
    'oceania': '🌏 Oceania'
};

// ==================== DATABASE ====================
const DATA_FILE = 'verified.json';
let verifiedUsers = {};

if (fs.existsSync(DATA_FILE)) {
    try { verifiedUsers = JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e) {}
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(verifiedUsers, null, 2));
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
    
    for (const [key, name] of Object.entries(EDITIONS)) {
        roles[`edition_${key}`] = await getOrCreateRole(guild, name, 0xE67E22);
    }
    for (const [key, name] of Object.entries(DEVICES)) {
        roles[`device_${key}`] = await getOrCreateRole(guild, name, 0x3498DB);
    }
    for (const [key, name] of Object.entries(REGIONS)) {
        roles[`region_${key}`] = await getOrCreateRole(guild, name, 0xF39C12);
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
        .addOptions(Object.entries(EDITIONS).map(([val, name]) => ({ label: name, value: val })));
    
    const deviceSelect = new StringSelectMenuBuilder()
        .setCustomId('device')
        .setPlaceholder('Select your device')
        .addOptions(Object.entries(DEVICES).map(([val, name]) => ({ label: name, value: val })));
    
    const regionSelect = new StringSelectMenuBuilder()
        .setCustomId('region')
        .setPlaceholder('Select your region')
        .addOptions(Object.entries(REGIONS).map(([val, name]) => ({ label: name, value: val })));
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(usernameInput),
        new ActionRowBuilder().addComponents(editionSelect),
        new ActionRowBuilder().addComponents(deviceSelect),
        new ActionRowBuilder().addComponents(regionSelect)
    );
    
    await interaction.showModal(modal);
}

// ==================== VERIFY MEMBER ====================
async function verifyMember(member, username, edition, device, region) {
    const guild = member.guild;
    const roles = await setupRoles(guild);
    
    // Check if already verified
    if (member.roles.cache.has(roles.verified.id)) {
        return { success: false, message: '❌ You are already verified!' };
    }
    
    // Validate username format
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        return { success: false, message: '❌ Invalid username. Use 3-16 letters, numbers, or underscores.' };
    }
    
    // Check for duplicate IGN
    if (verifiedUsers[username.toLowerCase()] && verifiedUsers[username.toLowerCase()] !== member.id) {
        return { success: false, message: '❌ This username is already verified by another member.' };
    }
    
    // Verify Java username with Mojang API
    let finalUsername = username;
    if (edition === 'java') {
        const mojangName = await checkJavaUsername(username);
        if (!mojangName) {
            return { success: false, message: '❌ Java username does not exist on Mojang.' };
        }
        finalUsername = mojangName;
    }
    
    // Change nickname
    try {
        await member.setNickname(finalUsername);
    } catch(e) {
        console.log(`Could not change nickname for ${member.user.tag}:`, e.message);
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
    verifiedUsers[finalUsername.toLowerCase()] = member.id;
    saveData();
    
    // Send welcome message
    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\n**Minecraft Username:** ${finalUsername}\n**Edition:** ${EDITIONS[edition]}\n**Device:** ${DEVICES[device]}\n**Region:** ${REGIONS[region]}\n━━━━━━━━━━━━━━━━━━━━\nYou now have access to all channels.`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${finalUsername}**! You now have access to all channels.` };
}

// ==================== SEND VERIFY BUTTON ====================
async function sendVerifyButton(channel) {
    const embed = {
        title: '🔐 MINECRAFT VERIFICATION',
        description: '━━━━━━━━━━━━━━━━━━━━\nClick the button below to verify your Minecraft account.\n\n**You will need:**\n• Your Minecraft username\n• Your game edition\n• Your device\n• Your region\n━━━━━━━━━━━━━━━━━━━━',
        color: 0x2ECC71,
        footer: { text: 'Verification is required to access the server' }
    };
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_btn')
            .setLabel('✅ VERIFY NOW')
            .setStyle(ButtonStyle.Success)
    );
    
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await msg.pin().catch(() => {});
}

// ==================== COMMANDS ====================
async function registerCommands() {
    const commands = [
        { name: 'verifybtn', description: 'Send verification button (Staff only)' },
        { name: 'forceverify', description: 'Force verify a member (Staff only)', options: [{ name: 'member', type: 6, required: true, description: 'Member to verify' }] },
        { name: 'unverify', description: 'Remove verification (Staff only)', options: [{ name: 'member', type: 6, required: true, description: 'Member to unverify' }] },
        { name: 'checkign', description: 'Check member IGN (Staff only)', options: [{ name: 'member', type: 6, required: true, description: 'Member to check' }] }
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
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (!member.roles.cache.has(roles.verified.id) && !member.roles.cache.has(roles.unverified.id)) {
            await member.roles.add(roles.unverified);
            count++;
        }
    }
    
    console.log(`✅ Ready | Gave ☘️ Unverified to ${count} members`);
    console.log('📌 Staff: Use /verifybtn in #verify channel');
});

client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    const roles = await setupRoles(member.guild);
    if (!member.roles.cache.has(roles.verified.id) && roles.unverified) {
        await member.roles.add(roles.unverified);
    }
});

// ==================== INTERACTION HANDLER ====================
client.on('interactionCreate', async interaction => {
    // BUTTON HANDLER
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        console.log(`🔘 ${interaction.user.tag} clicked verify button`);
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
    
    if (commandName === 'verifybtn' && isStaff) {
        if (channel.name !== VERIFY_CHANNEL) {
            return interaction.reply({ content: `❌ Use this in #${VERIFY_CHANNEL}`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await sendVerifyButton(channel);
        await interaction.editReply({ content: '✅ Verification button sent!' });
    }
    else if (commandName === 'forceverify' && isStaff) {
        const target = options.getMember('member');
        await showVerificationModal(interaction);
        interaction.client.forceTarget = target.id;
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
            if (role && target.roles.cache.has(role.id) && role.name !== roles.unverified.name && role.name !== roles.player.name && role.name !== roles.verified.name) {
                await target.roles.remove(role);
            }
        }
        
        try { await target.setNickname(null); } catch(e) {}
        
        const oldIgn = Object.keys(verifiedUsers).find(key => verifiedUsers[key] === target.id);
        if (oldIgn) delete verifiedUsers[oldIgn];
        saveData();
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}`, ephemeral: true });
    }
    else if (commandName === 'checkign' && isStaff) {
        const target = options.getMember('member');
        const ign = Object.keys(verifiedUsers).find(key => verifiedUsers[key] === target.id);
        if (ign) {
            await interaction.reply({ content: `**${target.user.tag}**\nIGN: ${ign}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
    else if (!isStaff && ['verifybtn', 'forceverify', 'unverify', 'checkign'].includes(commandName)) {
        await interaction.reply({ content: '❌ Staff only command.', ephemeral: true });
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', (error) => console.error('❌ Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('❌ Uncaught exception:', error));

client.login(TOKEN);