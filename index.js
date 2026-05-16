const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField, Partials } = require('discord.js');
const fs = require('fs');
const express = require('express');
const fetch = require('node-fetch');

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
    ],
    partials: [Partials.Channel]
});

const TOKEN = process.env.IGN_TOKEN;
const CLIENT_ID = process.env.IGN_CLIENT_ID;
const GUILD_ID = process.env.IGN_GUILD_ID;

// ==================== CONFIGURATION ====================
const VERIFIED_ROLE = '✅ Verified';
const PLAYER_ROLE = '⚔️ Player';
const UNVERIFIED_ROLE = '☘️ Unverified';
const VERIFY_CHANNEL = 'verify';

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
let db = { users: {}, ignToUser: {} };
const DATA_FILE = 'verify.json';
if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e) {}
}
function saveDB() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// ==================== ROLE HELPERS ====================
async function getOrCreateRole(guild, name, color) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) {
        role = await guild.roles.create({ name, color, reason: 'Verification' });
        console.log(`✅ Created role: ${name}`);
    }
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

// ==================== FORCE TARGET STORAGE ====================
let forceTargetId = null;

// ==================== ONE MODAL WITH ALL FIELDS ====================
async function showVerificationModal(interaction, targetMember = null) {
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
    
    if (targetMember) {
        forceTargetId = targetMember.id;
    }
    
    await interaction.showModal(modal);
}

// ==================== VERIFY MEMBER ====================
async function verifyMember(member, username, edition, device, region) {
    const guild = member.guild;
    const roles = await setupRoles(guild);
    
    if (member.roles.cache.has(roles.verified.id)) {
        return { success: false, message: '❌ You are already verified!' };
    }
    
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        return { success: false, message: '❌ Invalid username. Use 3-16 letters, numbers, or underscores.' };
    }
    
    edition = edition.toLowerCase();
    if (edition !== 'java' && edition !== 'bedrock') {
        return { success: false, message: '❌ Invalid edition. Use "java" or "bedrock".' };
    }
    
    device = device.toLowerCase();
    if (!DEVICES[device]) {
        return { success: false, message: '❌ Invalid device. Options: mobile, pc, controller, playstation, switch' };
    }
    
    region = region.toLowerCase();
    if (!REGIONS[region]) {
        return { success: false, message: '❌ Invalid region. Options: asia, europe, america, africa, oceania' };
    }
    
    if (db.ignToUser[username.toLowerCase()] && db.ignToUser[username.toLowerCase()] !== member.id) {
        return { success: false, message: '❌ This username is already verified by another member.' };
    }
    
    let finalUsername = username;
    if (edition === 'java') {
        const mojangName = await checkJavaUsername(username);
        if (!mojangName) {
            return { success: false, message: '❌ Java username does not exist on Mojang.' };
        }
        finalUsername = mojangName;
    }
    
    try {
        await member.setNickname(finalUsername);
    } catch(e) { console.log(`Nickname change failed: ${e.message}`); }
    
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
    saveDB();
    
    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\n**Minecraft Username:** ${finalUsername}\n**Edition:** ${EDITIONS[edition]}\n**Device:** ${DEVICES[device]}\n**Region:** ${REGIONS[region]}\n━━━━━━━━━━━━━━━━━━━━\nYou now have access to all channels.`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${finalUsername}**!\n━━━━━━━━━━━━━━━━━━━━\n**Edition:** ${EDITIONS[edition]}\n**Device:** ${DEVICES[device]}\n**Region:** ${REGIONS[region]}` };
}

// ==================== SEND VERIFY BUTTON ====================
async function sendVerifyButton(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🔐 MINECRAFT VERIFICATION')
        .setDescription('Click the button below to verify your Minecraft account.\n\n**You will need:**\n• Your Minecraft username\n• Your game edition (java / bedrock)\n• Your device\n• Your region')
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

// ==================== COMMANDS ====================
async function registerCommands() {
    const commands = [
        { name: 'sendverify', description: '[Staff] Send verification button' },
        { name: 'notify', description: '[Staff] Send reminder to unverified members' },
        { name: 'help', description: '[Staff] Show all commands' },
        { name: 'forceverify', description: '[Staff] Force verify a member', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'unverify', description: '[Staff] Remove verification', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'checkign', description: '[Staff] Check member IGN', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'changedevice', description: '[Staff] Change member device', options: [{ name: 'member', type: 6, required: true }, { name: 'device', type: 3, required: true, choices: Object.entries(DEVICES).map(([val, name]) => ({ name, value: val })) }] },
        { name: 'changeregion', description: '[Staff] Change member region', options: [{ name: 'member', type: 6, required: true }, { name: 'region', type: 3, required: true, choices: Object.entries(REGIONS).map(([val, name]) => ({ name, value: val })) }] },
        { name: 'changeedition', description: '[Staff] Change member edition', options: [{ name: 'member', type: 6, required: true }, { name: 'edition', type: 3, required: true, choices: Object.entries(EDITIONS).map(([val, name]) => ({ name, value: val })) }] }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered');
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
    
    console.log('✅ Ready | Staff use /sendverify in #verify');
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
        
        // Acknowledge immediately to prevent timeout
        await interaction.deferReply({ ephemeral: true });
        
        const roles = await setupRoles(interaction.guild);
        if (interaction.member.roles.cache.has(roles.verified.id)) {
            return interaction.editReply({ content: '❌ You are already verified!' });
        }
        
        await showVerificationModal(interaction);
        await interaction.deleteReply(); // Remove the defer message
        return;
    }
    
    // MODAL HANDLER
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        console.log(`📝 ${interaction.user.tag} submitted verification`);
        
        // Determine who to verify (staff using forceverify or the user themselves)
        let targetMember = interaction.member;
        if (forceTargetId) {
            try {
                targetMember = await interaction.guild.members.fetch(forceTargetId);
                forceTargetId = null;
            } catch(e) { console.log('Invalid force target'); }
        }
        
        const username = interaction.fields.getTextInputValue('username');
        const edition = interaction.fields.getTextInputValue('edition');
        const device = interaction.fields.getTextInputValue('device');
        const region = interaction.fields.getTextInputValue('region');
        
        await interaction.deferReply({ ephemeral: true });
        const result = await verifyMember(targetMember, username, edition, device, region);
        await interaction.editReply({ content: result.message });
        return;
    }
    
    // COMMAND HANDLER
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, member, channel, guild } = interaction;
    const isStaff = member.permissions.has(PermissionsBitField.Flags.Administrator);
    
    if (!isStaff && commandName !== 'sendverify') {
        return interaction.reply({ content: '❌ Staff only command.', ephemeral: true });
    }
    
    if (commandName === 'sendverify' && isStaff) {
        if (channel.name !== VERIFY_CHANNEL) {
            return interaction.reply({ content: `❌ Use this in #${VERIFY_CHANNEL}`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await sendVerifyButton(channel);
        await interaction.editReply({ content: '✅ Verification button sent!' });
    }
    else if (commandName === 'notify' && isStaff) {
        await interaction.deferReply({ ephemeral: true });
        const roles = await setupRoles(guild);
        const members = await guild.members.fetch();
        let count = 0;
        for (const m of members.values()) {
            if (m.user.bot) continue;
            if (!m.roles.cache.has(roles.verified.id) && m.roles.cache.has(roles.unverified.id)) {
                try { await m.send(`Verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL}.`); count++; await new Promise(r => setTimeout(r, 500)); } catch(e) {}
            }
        }
        await interaction.editReply({ content: `✅ Sent reminders to ${count} members.` });
    }
    else if (commandName === 'help' && isStaff) {
        const helpText = `**📋 STAFF COMMANDS**\n/sendverify - Send verification button\n/notify - Remind unverified members\n/forceverify @user - Force verify\n/unverify @user - Remove verification\n/checkign @user - Check IGN\n/changedevice @user device - Change device\n/changeregion @user region - Change region\n/changeedition @user edition - Change edition`;
        await interaction.reply({ content: helpText, ephemeral: true });
    }
    else if (commandName === 'forceverify' && isStaff) {
        const target = options.getMember('member');
        await showVerificationModal(interaction, target);
    }
    else if (commandName === 'unverify' && isStaff) {
        const target = options.getMember('member');
        const roles = await setupRoles(guild);
        if (!target.roles.cache.has(roles.verified.id)) return interaction.reply({ content: '❌ Not verified.', ephemeral: true });
        await target.roles.remove(roles.verified);
        await target.roles.remove(roles.player);
        if (roles.unverified) await target.roles.add(roles.unverified);
        for (const [key, role] of Object.entries(roles)) {
            if (role && target.roles.cache.has(role.id) && !role.name.includes(VERIFIED_ROLE) && !role.name.includes(PLAYER_ROLE) && !role.name.includes(UNVERIFIED_ROLE)) {
                await target.roles.remove(role);
            }
        }
        try { await target.setNickname(null); } catch(e) {}
        delete db.users[target.id];
        saveDB();
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}`, ephemeral: true });
    }
    else if (commandName === 'checkign' && isStaff) {
        const target = options.getMember('member');
        const data = db.users[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}**\nIGN: ${data.username}\nEdition: ${EDITIONS[data.edition]}\nDevice: ${DEVICES[data.device]}\nRegion: ${REGIONS[data.region]}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
    else if (commandName === 'changedevice' && isStaff) {
        const target = options.getMember('member');
        const newDevice = options.getString('device');
        const roles = await setupRoles(guild);
        const data = db.users[target.id];
        if (!data) return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        for (const [key, role] of Object.entries(roles)) {
            if (key.startsWith('device_') && target.roles.cache.has(role.id)) await target.roles.remove(role);
        }
        await target.roles.add(roles[`device_${newDevice}`]);
        data.device = newDevice;
        saveDB();
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s device to ${DEVICES[newDevice]}`, ephemeral: true });
    }
    else if (commandName === 'changeregion' && isStaff) {
        const target = options.getMember('member');
        const newRegion = options.getString('region');
        const roles = await setupRoles(guild);
        const data = db.users[target.id];
        if (!data) return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        for (const [key, role] of Object.entries(roles)) {
            if (key.startsWith('region_') && target.roles.cache.has(role.id)) await target.roles.remove(role);
        }
        await target.roles.add(roles[`region_${newRegion}`]);
        data.region = newRegion;
        saveDB();
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s region to ${REGIONS[newRegion]}`, ephemeral: true });
    }
    else if (commandName === 'changeedition' && isStaff) {
        const target = options.getMember('member');
        const newEdition = options.getString('edition');
        const roles = await setupRoles(guild);
        const data = db.users[target.id];
        if (!data) return interaction.reply({ content: '❌ Member not verified.', ephemeral: true });
        for (const [key, role] of Object.entries(roles)) {
            if (key.startsWith('edition_') && target.roles.cache.has(role.id)) await target.roles.remove(role);
        }
        await target.roles.add(roles[`edition_${newEdition}`]);
        data.edition = newEdition;
        saveDB();
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s edition to ${EDITIONS[newEdition]}`, ephemeral: true });
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

client.login(TOKEN);