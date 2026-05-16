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
const UNVERIFIED_ROLE = '☘️ Unverified';
const VERIFY_CHANNEL = 'verify';

// ==================== DATABASE ====================
let verifiedUsers = {};
const DATA_FILE = 'verify.json';
if (fs.existsSync(DATA_FILE)) {
    try { verifiedUsers = JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e) {}
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(verifiedUsers, null, 2)); }

// ==================== ROLE HELPER ====================
async function getRole(guild, name, color) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) role = await guild.roles.create({ name, color });
    return role;
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

// ==================== MODAL ====================
async function showModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('Minecraft Verification');
    
    const input = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('Minecraft Username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Enter your Minecraft username');
    
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

// ==================== VERIFY MEMBER ====================
async function verifyMember(member, username) {
    const guild = member.guild;
    const verifiedRole = await getRole(guild, VERIFIED_ROLE, 0x2ECC71);
    const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE, 0x7F8C8D);
    
    if (member.roles.cache.has(verifiedRole.id)) {
        return { success: false, message: '❌ Already verified!' };
    }
    
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
        return { success: false, message: '❌ Invalid username!' };
    }
    
    const mojangName = await checkJavaUsername(username);
    if (!mojangName) {
        return { success: false, message: '❌ Java username does not exist!' };
    }
    
    try { await member.setNickname(mojangName); } catch(e) {}
    
    if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
        await member.roles.remove(unverifiedRole);
    }
    await member.roles.add(verifiedRole);
    
    verifiedUsers[member.id] = mojangName;
    saveData();
    
    try {
        await member.send(`✅ **Welcome!** Verified as **${mojangName}**`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${mojangName}**!` };
}

// ==================== COMMANDS ====================
async function registerCommands() {
    const commands = [
        { name: 'verify', description: 'Verify your Minecraft account' },
        { name: 'sendverify', description: '[Staff] Send verification button' },
        { name: 'notify', description: '[Staff] Remind unverified members' },
        { name: 'help', description: '[Staff] Show commands' }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Global commands registered (may take 5-10 mins to appear)');
}

// ==================== SEND BUTTON ====================
async function sendVerifyButton(channel) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_btn')
            .setLabel('✅ VERIFY NOW')
            .setStyle(ButtonStyle.Success)
    );
    await channel.send({ content: 'Click below to verify:', components: [row] });
}

// ==================== READY ====================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('❌ Guild not found!');
    
    await getRole(guild, VERIFIED_ROLE, 0x2ECC71);
    await getRole(guild, UNVERIFIED_ROLE, 0x7F8C8D);
    await registerCommands();
    
    const members = await guild.members.fetch();
    let count = 0;
    for (const member of members.values()) {
        if (member.user.bot) continue;
        const unverifiedRole = guild.roles.cache.find(r => r.name === UNVERIFIED_ROLE);
        if (unverifiedRole && !member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.add(unverifiedRole);
            count++;
        }
    }
    console.log(`✅ Ready | Gave unverified to ${count} members`);
});

// ==================== INTERACTIONS ====================
client.on('interactionCreate', async interaction => {
    // BUTTON
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        await showModal(interaction);
        return;
    }
    
    // MODAL
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        const username = interaction.fields.getTextInputValue('username');
        await interaction.deferReply({ ephemeral: true });
        const result = await verifyMember(interaction.member, username);
        await interaction.editReply({ content: result.message });
        return;
    }
    
    // SLASH COMMANDS
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, member, channel, guild } = interaction;
    const isStaff = member.permissions.has(PermissionsBitField.Flags.Administrator);
    
    if (commandName === 'verify') {
        await showModal(interaction);
    }
    else if (commandName === 'sendverify' && isStaff) {
        await sendVerifyButton(channel);
        await interaction.reply({ content: '✅ Button sent!', ephemeral: true });
    }
    else if (commandName === 'notify' && isStaff) {
        await interaction.reply({ content: '📨 Sending...', ephemeral: true });
        const members = await guild.members.fetch();
        const unverifiedRole = guild.roles.cache.find(r => r.name === UNVERIFIED_ROLE);
        let count = 0;
        for (const m of members.values()) {
            if (m.user.bot) continue;
            if (unverifiedRole && m.roles.cache.has(unverifiedRole.id)) {
                try { await m.send(`Verify with /verify in #${VERIFY_CHANNEL}`); count++; } catch(e) {}
                await new Promise(r => setTimeout(r, 500));
            }
        }
        await interaction.editReply({ content: `✅ Sent to ${count} members` });
    }
    else if (commandName === 'help' && isStaff) {
        await interaction.reply({ content: '**Commands:**\n/verify - Verify\n/sendverify - Send button\n/notify - Remind unverified', ephemeral: true });
    }
    else if (!isStaff) {
        await interaction.reply({ content: '❌ Staff only', ephemeral: true });
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);