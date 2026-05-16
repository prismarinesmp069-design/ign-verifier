const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField, Partials } = require('discord.js');
const fs = require('fs').promises;
const express = require('express');
const fetch = require('node-fetch');

// ==================== ENVIRONMENT VALIDATION ====================
const TOKEN = process.env.IGN_TOKEN;
const CLIENT_ID = process.env.IGN_CLIENT_ID;
const GUILD_ID = process.env.IGN_GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error('❌ Missing required environment variables');
    process.exit(1);
}

// ==================== KEEP-ALIVE SERVER ====================
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(3000, () => console.log('🌐 Server on port 3000'));

// ==================== DISCORD CLIENT ====================
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

// ==================== ROLE CACHE ====================
client.roleCache = {};

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

async function loadDB() {
    try { db = JSON.parse(await fs.readFile(DATA_FILE, 'utf-8')); } catch(e) {}
}

async function saveDB() { await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2)); }

// ==================== ROLE HELPERS ====================
async function getOrCreateRole(guild, name, color) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) role = await guild.roles.create({ name, color, reason: 'Verification' });
    return role;
}

async function setupRoles(guild) {
    if (client.roleCache[guild.id]) return client.roleCache[guild.id];
    
    const roles = {
        verified: await getOrCreateRole(guild, VERIFIED_ROLE, 0x2ECC71),
        player: await getOrCreateRole(guild, PLAYER_ROLE, 0xF1C40F),
        unverified: await getOrCreateRole(guild, UNVERIFIED_ROLE, 0x7F8C8D),
        editions: {},
        devices: {},
        regions: {}
    };
    
    for (const [key, name] of Object.entries(EDITIONS)) roles.editions[key] = await getOrCreateRole(guild, name, 0xE67E22);
    for (const [key, name] of Object.entries(DEVICES)) roles.devices[key] = await getOrCreateRole(guild, name, 0x3498DB);
    for (const [key, name] of Object.entries(REGIONS)) roles.regions[key] = await getOrCreateRole(guild, name, 0xF39C12);
    
    client.roleCache[guild.id] = roles;
    return roles;
}

// ==================== API CHECKS ====================
async function checkJavaUsername(username) {
    try {
        const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.name;
    } catch(e) { return null; }
}

async function checkBedrockUsername(username) {
    if (/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) return username;
    return null;
}

// ==================== MODAL ====================
async function showVerificationModal(interaction, targetMember = null) {
    const targetId = targetMember?.id || interaction.user.id;
    
    const modal = new ModalBuilder()
        .setCustomId(`verify_modal:${targetId}`)
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
    } else {
        const bedrockName = await checkBedrockUsername(username);
        if (!bedrockName) {
            return { success: false, message: '❌ Invalid Bedrock username. Use 3-16 letters, numbers, underscores, or spaces.' };
        }
    }
    
    try { await member.setNickname(finalUsername); } catch(e) {}
    
    if (roles.unverified && member.roles.cache.has(roles.unverified.id)) {
        await member.roles.remove(roles.unverified);
    }
    
    await member.roles.add(roles.verified);
    await member.roles.add(roles.player);
    await member.roles.add(roles.editions[edition]);
    await member.roles.add(roles.devices[device]);
    await member.roles.add(roles.regions[region]);
    
    db.users[member.id] = { username: finalUsername, edition, device, region, verifiedAt: Date.now() };
    db.ignToUser[finalUsername.toLowerCase()] = member.id;
    await saveDB();
    
    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\n**Minecraft Username:** ${finalUsername}\n**Edition:** ${EDITIONS[edition]}\n**Device:** ${DEVICES[device]}\n**Region:** ${REGIONS[region]}\n━━━━━━━━━━━━━━━━━━━━\nYou now have access to all channels.`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${finalUsername}**!` };
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
        { name: 'verifyinfo', description: 'Show verification instructions' },
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
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Global commands registered');
}

// ==================== SEND VERIFY INFO EMBED ====================
async function sendVerifyInfo(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🔐 MINECRAFT ACCOUNT VERIFICATION')
        .setDescription('To access the server, you must verify your Minecraft account.')
        .setColor(0x2ECC71)
        .addFields(
            { name: '📝 How to Verify', value: 'Click the **VERIFY NOW** button below and fill out the form.', inline: false },
            { name: '📋 What You Need', value: '• Your Minecraft username\n• Your game edition (Java/Bedrock)\n• Your device\n• Your region', inline: false },
            { name: '✅ After Verification', value: 'You will receive the `✅ Verified` role and gain access to all channels.', inline: false },
            { name: '❓ Need Help?', value: 'Contact a staff member if you have issues.', inline: false }
        )
        .setFooter({ text: 'Verification is required to prevent spam and ensure account ownership' });
    
    await channel.send({ embeds: [embed] });
}

// ==================== READY EVENT ====================
client.once('ready', async () => {
    console.log(`✅ IGN Verifier logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('❌ Guild not found!');
    
    await loadDB();
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
    console.log('📌 Staff use /sendverify in #verify channel');
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
    // BUTTON HANDLER - NO DEFER, DIRECT MODAL
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        console.log(`🔘 ${interaction.user.tag} clicked verify button`);
        
        const roles = await setupRoles(interaction.guild);
        if (interaction.member.roles.cache.has(roles.verified.id)) {
            return interaction.reply({ content: '❌ You are already verified!', ephemeral: true });
        }
        
        // DIRECT MODAL - NO DEFER
        await showVerificationModal(interaction);
        return;
    }
    
    // MODAL HANDLER
    if (interaction.isModalSubmit() && interaction.customId.startsWith('verify_modal:')) {
        console.log(`📝 ${interaction.user.tag} submitted verification`);
        
        const targetId = interaction.customId.split(':')[1];
        let targetMember = interaction.member;
        
        if (targetId && targetId !== interaction.user.id) {
            try { targetMember = await interaction.guild.members.fetch(targetId); } catch(e) {}
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
    
    if (commandName === 'sendverify' && isStaff) {
        if (channel.name !== VERIFY_CHANNEL) {
            return interaction.reply({ content: `❌ Use this in #${VERIFY_CHANNEL}`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await sendVerifyButton(channel);
        await interaction.editReply({ content: '✅ Verification button sent!' });
    }
    else if (commandName === 'verifyinfo') {
        await sendVerifyInfo(channel);
        await interaction.reply({ content: '✅ Verification info sent!', ephemeral: true });
    }
    else if (commandName === 'notify' && isStaff) {
        await interaction.reply({ content: '📨 Sending reminders...', ephemeral: true });
        const roles = await setupRoles(guild);
        const members = await guild.members.fetch();
        let count = 0;
        for (const m of members.values()) {
            if (m.user.bot) continue;
            if (!m.roles.cache.has(roles.verified.id) && m.roles.cache.has(roles.unverified.id)) {
                try { await m.send(`**🔐 Verification Required**\nClick the button in #${VERIFY_CHANNEL} to verify your Minecraft account.`); count++; } catch(e) {}
                await new Promise(r => setTimeout(r, 500));
            }
        }
        await interaction.editReply({ content: `✅ Sent reminders to ${count} members.` });
    }
    else if (commandName === 'help' && isStaff) {
        const helpText = `**📋 STAFF COMMANDS**\n━━━━━━━━━━━━━━━━━━━━\n**/sendverify** - Send verification button in #verify\n**/verifyinfo** - Send verification instructions\n**/notify** - Send DM reminder to unverified members\n**/forceverify @user** - Force verify a member\n**/unverify @user** - Remove verification\n**/checkign @user** - Check member's IGN\n**/changedevice @user device** - Change member's device\n**/changeregion @user region** - Change member's region\n**/changeedition @user edition** - Change member's edition\n━━━━━━━━━━━━━━━━━━━━\n**Devices:** ${Object.values(DEVICES).join(', ')}\n**Regions:** ${Object.values(REGIONS).join(', ')}\n**Editions:** ${Object.values(EDITIONS).join(', ')}`;
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
        
        for (const role of Object.values(roles.editions)) if (target.roles.cache.has(role.id)) await target.roles.remove(role);
        for (const role of Object.values(roles.devices)) if (target.roles.cache.has(role.id)) await target.roles.remove(role);
        for (const role of Object.values(roles.regions)) if (target.roles.cache.has(role.id)) await target.roles.remove(role);
        
        try { await target.setNickname(null); } catch(e) {}
        
        const oldIgn = db.users[target.id]?.username;
        if (oldIgn) delete db.ignToUser[oldIgn.toLowerCase()];
        delete db.users[target.id];
        await saveDB();
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}`, ephemeral: true });
    }
    else if (commandName === 'checkign' && isStaff) {
        const target = options.getMember('member');
        const data = db.users[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}**\n━━━━━━━━━━━━━━━━━━━━\n**IGN:** ${data.username}\n**Edition:** ${EDITIONS[data.edition]}\n**Device:** ${DEVICES[data.device]}\n**Region:** ${REGIONS[data.region]}\n**Verified:** ${new Date(data.verifiedAt).toLocaleString()}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, ephemeral: true });
        }
    }
    else if (commandName === 'changedevice' && isStaff) {
        const target = options.getMember('member');
        const newDevice = options.getString('device');
        const roles = await setupRoles(guild);
        const data = db.users[target.id];
        if (!data) return interaction.reply({ content: '❌ Not verified.', ephemeral: true });
        
        for (const role of Object.values(roles.devices)) if (target.roles.cache.has(role.id)) await target.roles.remove(role);
        await target.roles.add(roles.devices[newDevice]);
        data.device = newDevice;
        await saveDB();
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s device to ${DEVICES[newDevice]}`, ephemeral: true });
    }
    else if (commandName === 'changeregion' && isStaff) {
        const target = options.getMember('member');
        const newRegion = options.getString('region');
        const roles = await setupRoles(guild);
        const data = db.users[target.id];
        if (!data) return interaction.reply({ content: '❌ Not verified.', ephemeral: true });
        
        for (const role of Object.values(roles.regions)) if (target.roles.cache.has(role.id)) await target.roles.remove(role);
        await target.roles.add(roles.regions[newRegion]);
        data.region = newRegion;
        await saveDB();
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s region to ${REGIONS[newRegion]}`, ephemeral: true });
    }
    else if (commandName === 'changeedition' && isStaff) {
        const target = options.getMember('member');
        const newEdition = options.getString('edition');
        const roles = await setupRoles(guild);
        const data = db.users[target.id];
        if (!data) return interaction.reply({ content: '❌ Not verified.', ephemeral: true });
        
        for (const role of Object.values(roles.editions)) if (target.roles.cache.has(role.id)) await target.roles.remove(role);
        await target.roles.add(roles.editions[newEdition]);
        data.edition = newEdition;
        await saveDB();
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s edition to ${EDITIONS[newEdition]}`, ephemeral: true });
    }
    else if (!isStaff && ['sendverify', 'notify', 'forceverify', 'unverify', 'checkign', 'changedevice', 'changeregion', 'changeedition', 'help'].includes(commandName)) {
        await interaction.reply({ content: '❌ Staff only command.', ephemeral: true });
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

client.login(TOKEN);