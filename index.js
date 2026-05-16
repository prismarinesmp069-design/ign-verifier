const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const express = require('express');

// ==================== KEEP-ALIVE SERVER ====================
const keepAliveApp = express();
keepAliveApp.get('/', (req, res) => res.send('Bot is alive!'));
keepAliveApp.listen(3000, () => console.log('🌐 Server on port 3000'));

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
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// ==================== ROLE HELPERS (NO CREATION) ====================
async function getRole(guild, name) {
    return guild.roles.cache.find(r => r.name === name);
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

// ==================== MODAL WITH ALL FIELDS ====================
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
    
    // Get existing roles (NO CREATION)
    const verifiedRole = await getRole(guild, VERIFIED_ROLE);
    const playerRole = await getRole(guild, PLAYER_ROLE);
    const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
    const editionRole = await getRole(guild, EDITIONS[edition]);
    const deviceRole = await getRole(guild, DEVICES[device]);
    const regionRole = await getRole(guild, REGIONS[region]);
    
    if (!verifiedRole || !playerRole) {
        return { success: false, message: '❌ Required roles not found. Please contact staff.' };
    }
    
    if (member.roles.cache.has(verifiedRole.id)) {
        return { success: false, message: '❌ Already verified!' };
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
    
    try { await member.setNickname(finalUsername); } catch(e) {}
    
    if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
        await member.roles.remove(unverifiedRole);
    }
    
    await member.roles.add(verifiedRole);
    await member.roles.add(playerRole);
    if (editionRole) await member.roles.add(editionRole);
    if (deviceRole) await member.roles.add(deviceRole);
    if (regionRole) await member.roles.add(regionRole);
    
    db.users[member.id] = { username: finalUsername, edition, device, region, verifiedAt: Date.now() };
    db.ignToUser[finalUsername.toLowerCase()] = member.id;
    saveData();
    
    try {
        await member.send(`✅ **Welcome!**\n━━━━━━━━━━━━━━━━━━━━\n**Minecraft Username:** ${finalUsername}\n**Edition:** ${EDITIONS[edition]}\n**Device:** ${DEVICES[device]}\n**Region:** ${REGIONS[region]}`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${finalUsername}**!\nEdition: ${EDITIONS[edition]}\nDevice: ${DEVICES[device]}\nRegion: ${REGIONS[region]}` };
}

// ==================== COMMANDS ====================
async function registerCommands() {
    const commands = [
        { name: 'verify', description: 'Verify your Minecraft account' },
        { name: 'sendverify', description: '[Staff] Send verification button' },
        { name: 'notify', description: '[Staff] Remind unverified members' },
        { name: 'help', description: '[Staff] Show commands' },
        { name: 'forceverify', description: '[Staff] Force verify a member', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'unverify', description: '[Staff] Remove verification', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'checkign', description: '[Staff] Check member IGN', options: [{ name: 'member', type: 6, required: true }] }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Global commands registered');
}

// ==================== SEND BUTTON ====================
async function sendVerifyButton(channel) {
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

// ==================== READY ====================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('❌ Guild not found!');
    
    await registerCommands();
    
    const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
    const members = await guild.members.fetch();
    let count = 0;
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (unverifiedRole && !member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.add(unverifiedRole);
            count++;
        }
    }
    console.log(`✅ Ready | Gave ☘️ Unverified to ${count} members`);
});

// ==================== INTERACTIONS ====================
client.on('interactionCreate', async interaction => {
    // BUTTON
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        const verifiedRole = await getRole(interaction.guild, VERIFIED_ROLE);
        if (verifiedRole && interaction.member.roles.cache.has(verifiedRole.id)) {
            return interaction.reply({ content: '❌ You are already verified!', ephemeral: true });
        }
        await showModal(interaction);
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
    
    // SLASH COMMANDS
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, member, channel, guild } = interaction;
    const isStaff = member.permissions.has(PermissionsBitField.Flags.Administrator);
    
    if (commandName === 'verify') {
        await showModal(interaction);
    }
    else if (commandName === 'sendverify' && isStaff) {
        if (channel.name !== VERIFY_CHANNEL) {
            return interaction.reply({ content: `❌ Use in #${VERIFY_CHANNEL}`, ephemeral: true });
        }
        await sendVerifyButton(channel);
        await interaction.reply({ content: '✅ Verification button sent!', ephemeral: true });
    }
    else if (commandName === 'notify' && isStaff) {
        await interaction.reply({ content: '📨 Sending reminders...', ephemeral: true });
        const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
        const members = await guild.members.fetch();
        let count = 0;
        for (const m of members.values()) {
            if (m.user.bot) continue;
            if (unverifiedRole && m.roles.cache.has(unverifiedRole.id)) {
                try { await m.send(`**🔐 Verification Required**\nClick the button in #${VERIFY_CHANNEL} to verify.`); count++; } catch(e) {}
                await new Promise(r => setTimeout(r, 500));
            }
        }
        await interaction.editReply({ content: `✅ Sent reminders to ${count} members.` });
    }
    else if (commandName === 'help' && isStaff) {
        const helpText = `**📋 STAFF COMMANDS**\n━━━━━━━━━━━━━━━━━━━━\n**/verify** - Open verification\n**/sendverify** - Send button\n**/notify** - Remind unverified\n**/forceverify @user** - Force verify\n**/unverify @user** - Remove verification\n**/checkign @user** - Check IGN`;
        await interaction.reply({ content: helpText, ephemeral: true });
    }
    else if (commandName === 'forceverify' && isStaff) {
        await showModal(interaction);
    }
    else if (commandName === 'unverify' && isStaff) {
        const target = options.getMember('member');
        const verifiedRole = await getRole(guild, VERIFIED_ROLE);
        const playerRole = await getRole(guild, PLAYER_ROLE);
        const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
        
        if (!verifiedRole || !target.roles.cache.has(verifiedRole.id)) {
            return interaction.reply({ content: '❌ Not verified.', ephemeral: true });
        }
        
        await target.roles.remove(verifiedRole);
        if (playerRole) await target.roles.remove(playerRole);
        if (unverifiedRole) await target.roles.add(unverifiedRole);
        
        // Remove edition/device/region roles
        for (const [key, name] of Object.entries(EDITIONS)) {
            const role = await getRole(guild, name);
            if (role && target.roles.cache.has(role.id)) await target.roles.remove(role);
        }
        for (const [key, name] of Object.entries(DEVICES)) {
            const role = await getRole(guild, name);
            if (role && target.roles.cache.has(role.id)) await target.roles.remove(role);
        }
        for (const [key, name] of Object.entries(REGIONS)) {
            const role = await getRole(guild, name);
            if (role && target.roles.cache.has(role.id)) await target.roles.remove(role);
        }
        
        try { await target.setNickname(null); } catch(e) {}
        
        const oldIgn = db.users[target.id]?.username;
        if (oldIgn) delete db.ignToUser[oldIgn.toLowerCase()];
        delete db.users[target.id];
        saveData();
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}`, ephemeral: true });
    }
    else if (commandName === 'checkign' && isStaff) {
        const target = options.getMember('member');
        const data = db.users[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}**\nIGN: ${data.username}\nEdition: ${EDITIONS[data.edition]}\nDevice: ${DEVICES[data.device]}\nRegion: ${REGIONS[data.region]}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${target.user.tag} not verified.`, ephemeral: true });
        }
    }
    else if (!isStaff && ['sendverify', 'notify', 'forceverify', 'unverify', 'checkign', 'help'].includes(commandName)) {
        await interaction.reply({ content: '❌ Staff only command.', ephemeral: true });
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);