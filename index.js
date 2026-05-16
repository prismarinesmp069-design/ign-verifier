const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
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
const LOG_CHANNEL = 'logs';
const REMINDER_INTERVAL = 60 * 60 * 1000;

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
let db = { users: {}, ignToUser: {}, lastReminder: {} };
const DATA_FILE = 'verify.json';
if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE));
function saveDB() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// ==================== ROLE HELPERS ====================
async function getOrCreateRole(guild, name, color) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) role = await guild.roles.create({ name, color, reason: 'Verification' });
    return role;
}

async function setupRoles(guild) {
    const roles = {};
    roles.verified = await getOrCreateRole(guild, VERIFIED_ROLE, 0x2ECC71);
    roles.player = await getOrCreateRole(guild, PLAYER_ROLE, 0xF1C40F);
    roles.unverified = await getOrCreateRole(guild, UNVERIFIED_ROLE, 0x7F8C8D);
    
    for (const [key, name] of Object.entries(EDITIONS)) roles[`edition_${key}`] = await getOrCreateRole(guild, name, 0xE67E22);
    for (const [key, name] of Object.entries(DEVICES)) roles[`device_${key}`] = await getOrCreateRole(guild, name, 0x3498DB);
    for (const [key, name] of Object.entries(REGIONS)) roles[`region_${key}`] = await getOrCreateRole(guild, name, 0xF39C12);
    return roles;
}

// ==================== API CHECK ====================
async function checkJavaUsername(username) {
    try {
        const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.name;
    } catch(e) { return null; }
}

// ==================== ONE MODAL WITH ALL FIELDS ====================
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
    
    const editionInput = new TextInputBuilder()
        .setCustomId('edition')
        .setLabel('Edition (java / bedrock)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Type "java" or "bedrock"');
    
    const deviceInput = new TextInputBuilder()
        .setCustomId('device')
        .setLabel('Device (mobile / pc / controller / playstation / switch)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Enter your device');
    
    const regionInput = new TextInputBuilder()
        .setCustomId('region')
        .setLabel('Region (asia / europe / america / africa / oceania)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Enter your region');
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(usernameInput),
        new ActionRowBuilder().addComponents(editionInput),
        new ActionRowBuilder().addComponents(deviceInput),
        new ActionRowBuilder().addComponents(regionInput)
    );
    
    await interaction.showModal(modal);
}

// ==================== VERIFY MEMBER ====================
async function verifyMember(member, username, edition, device, region) {
    const guild = member.guild;
    const roles = await setupRoles(guild);
    
    if (member.roles.cache.has(roles.verified.id)) {
        return { success: false, message: '❌ You are already verified!' };
    }
    
    // Validate username format
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        return { success: false, message: '❌ Invalid username. Use 3-16 letters, numbers, or underscores.' };
    }
    
    // Validate edition
    edition = edition.toLowerCase();
    if (edition !== 'java' && edition !== 'bedrock') {
        return { success: false, message: '❌ Invalid edition. Use "java" or "bedrock".' };
    }
    
    // Validate device
    device = device.toLowerCase();
    if (!DEVICES[device]) {
        return { success: false, message: '❌ Invalid device. Options: mobile, pc, controller, playstation, switch' };
    }
    
    // Validate region
    region = region.toLowerCase();
    if (!REGIONS[region]) {
        return { success: false, message: '❌ Invalid region. Options: asia, europe, america, africa, oceania' };
    }
    
    // Check duplicate IGN
    if (db.ignToUser[username.toLowerCase()] && db.ignToUser[username.toLowerCase()] !== member.id) {
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
    } catch(e) { console.log(`Could not change nickname: ${e.message}`); }
    
    // Role changes
    if (roles.unverified && member.roles.cache.has(roles.unverified.id)) {
        await member.roles.remove(roles.unverified);
    }
    await member.roles.add(roles.verified);
    await member.roles.add(roles.player);
    await member.roles.add(roles[`edition_${edition}`]);
    await member.roles.add(roles[`device_${device}`]);
    await member.roles.add(roles[`region_${region}`]);
    
    // Save to database
    db.users[member.id] = { username: finalUsername, edition, device, region, verifiedAt: Date.now() };
    db.ignToUser[finalUsername.toLowerCase()] = member.id;
    saveDB();
    
    return { success: true, message: `✅ Verified as **${finalUsername}**!\nEdition: ${EDITIONS[edition]}\nDevice: ${DEVICES[device]}\nRegion: ${REGIONS[region]}` };
}

// ==================== SEND VERIFY BUTTON ====================
async function sendVerifyMessage(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🔐 MINECRAFT VERIFICATION')
        .setDescription('Click the button below to verify your Minecraft account.\n\n**You will need:**\n• Your Minecraft username\n• Your game edition (java / bedrock)\n• Your device\n• Your region')
        .setColor(0x2ECC71);
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_btn')
            .setLabel('✅ VERIFY NOW')
            .setStyle(ButtonStyle.Success)
    );
    
    await channel.send({ embeds: [embed], components: [row] });
}

// ==================== COMMANDS ====================
async function registerCommands() {
    const commands = [
        { name: 'sendverify', description: '[Staff] Send verification button' },
        { name: 'notify', description: '[Staff] Send reminder to unverified members' },
        { name: 'help', description: '[Staff] Show all commands' },
        { name: 'forceverify', description: '[Staff] Force verify a member', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'unverify', description: '[Staff] Remove verification', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'checkign', description: '[Staff] Check member IGN', options: [{ name: 'member', type: 6, required: true }] }
    ];
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

// ==================== READY EVENT ====================
client.once('ready', async () => {
    console.log(`✅ IGN Verifier logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('❌ Guild not found!');
    
    await setupRoles(guild);
    await registerCommands();
    
    const roles = await setupRoles(guild);
    const members = await guild.members.fetch();
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (!member.roles.cache.has(roles.verified.id) && !member.roles.cache.has(roles.unverified.id)) {
            await member.roles.add(roles.unverified);
        }
    }
    
    console.log('✅ Ready | Use /sendverify in #verify');
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
    // BUTTON
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        await showVerificationModal(interaction);
        return;
    }
    
    // MODAL
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        const username = interaction.fields.getTextInputValue('username');
        const edition = interaction.fields.getTextInputValue('edition');
        const device = interaction.fields.getTextInputValue('device');
        const region = interaction.fields.getTextInputValue('region');
        
        await interaction.deferReply({ ephemeral: true });
        const result = await verifyMember(interaction.member, username, edition, device, region);
        await interaction.editReply({ content: result.message });
        return;
    }
    
    // COMMANDS
    if (!interaction.isCommand()) return;
    
    const { commandName, options, member, channel, guild } = interaction;
    const isStaff = member.permissions.has('Administrator');
    if (!isStaff) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    
    if (commandName === 'sendverify') {
        if (channel.name !== VERIFY_CHANNEL) return interaction.reply({ content: `❌ Use in #${VERIFY_CHANNEL}`, ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        await sendVerifyMessage(channel);
        await interaction.editReply({ content: '✅ Verification button sent!' });
    }
    else if (commandName === 'notify') {
        await interaction.deferReply({ ephemeral: true });
        const roles = await setupRoles(guild);
        const members = await guild.members.fetch();
        let count = 0;
        for (const m of members.values()) {
            if (m.user.bot) continue;
            if (!m.roles.cache.has(roles.verified.id) && m.roles.cache.has(roles.unverified.id)) {
                try { await m.send(`Verify your Minecraft account in #${VERIFY_CHANNEL}.`); count++; await new Promise(r => setTimeout(r, 500)); } catch(e) {}
            }
        }
        await interaction.editReply({ content: `✅ Sent reminders to ${count} members.` });
    }
    else if (commandName === 'help') {
        const helpText = `**📋 STAFF COMMANDS**\n/sendverify - Send button\n/notify - Remind unverified\n/forceverify @user - Force verify\n/unverify @user - Remove verification\n/checkign @user - Check IGN`;
        await interaction.reply({ content: helpText, ephemeral: true });
    }
    else if (commandName === 'forceverify') {
        const target = options.getMember('member');
        await showVerificationModal(interaction);
        interaction.client.forceTarget = target.id;
    }
    else if (commandName === 'unverify') {
        const target = options.getMember('member');
        const roles = await setupRoles(guild);
        if (!target.roles.cache.has(roles.verified.id)) return interaction.reply({ content: '❌ Not verified.', ephemeral: true });
        await target.roles.remove(roles.verified);
        await target.roles.remove(roles.player);
        if (roles.unverified) await target.roles.add(roles.unverified);
        try { await target.setNickname(null); } catch(e) {}
        delete db.users[target.id];
        saveDB();
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}`, ephemeral: true });
    }
    else if (commandName === 'checkign') {
        const target = options.getMember('member');
        const data = db.users[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}**\nIGN: ${data.username}\nEdition: ${EDITIONS[data.edition]}\nDevice: ${DEVICES[data.device]}\nRegion: ${REGIONS[data.region]}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
});

client.login(TOKEN);