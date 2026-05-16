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
const LOG_CHANNEL = 'logs';

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
if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e) {}
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// ==================== ROLE HELPERS ====================
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

// ==================== MODAL ====================
async function showModal(interaction, targetId = null) {
    const modalId = targetId ? `verify_modal:${targetId}` : 'verify_modal';
    
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Minecraft Verification');
    
    const usernameInput = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('Minecraft Username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Enter your Minecraft username (spaces allowed)');
    
    const editionInput = new TextInputBuilder()
        .setCustomId('edition')
        .setLabel('Edition (java/bedrock)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Type java or bedrock');
    
    const deviceInput = new TextInputBuilder()
        .setCustomId('device')
        .setLabel('Device')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('mobile/pc/controller/playstation/switch');
    
    const regionInput = new TextInputBuilder()
        .setCustomId('region')
        .setLabel('Region')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('asia/europe/america/africa/oceania');
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(usernameInput),
        new ActionRowBuilder().addComponents(editionInput),
        new ActionRowBuilder().addComponents(deviceInput),
        new ActionRowBuilder().addComponents(regionInput)
    );
    
    await interaction.showModal(modal);
}

// ==================== VERIFY MEMBER ====================
async function verifyMember(member, username, edition, device, region, isForce = false) {
    const guild = member.guild;
    
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
    
    // Allow spaces for Bedrock usernames, letters, numbers, underscores
    if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) {
        return { success: false, message: '❌ Invalid username. Use 3-16 letters, numbers, spaces, or underscores.' };
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
    if (!isForce && edition === 'java') {
        const mojangName = await checkJavaUsername(username);
        if (!mojangName) {
            return { success: false, message: '❌ Java username does not exist on Mojang.' };
        }
        finalUsername = mojangName;
    }
    
    // CHANGE NICKNAME - This requires bot role to be HIGHER than member's highest role
    let nicknameChanged = false;
    try {
        await member.setNickname(finalUsername);
        nicknameChanged = true;
        console.log(`✅ Nickname changed for ${member.user.tag} to: ${finalUsername}`);
    } catch(e) {
        console.log(`❌ Failed to change nickname for ${member.user.tag}: ${e.message}`);
        console.log(`💡 Make sure bot role is ABOVE member roles in Server Settings → Roles`);
    }
    
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
    delete db.lastReminder[member.id];
    saveData();
    
    const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL);
    if (logChannel) {
        logChannel.send(`✅ **${member.user.tag}** verified as **${finalUsername}** (${edition} | ${device} | ${region})`);
    }
    
    let message = `✅ Verified as **${finalUsername}**!`;
    if (!nicknameChanged) {
        message += `\n\n⚠️ **Nickname could not be changed.**\nPlease ask a staff member to move the bot's role **ABOVE** your roles in Server Settings → Roles.`;
    }
    
    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\n**Minecraft Username:** ${finalUsername}\n**Edition:** ${EDITIONS[edition]}\n**Device:** ${DEVICES[device]}\n**Region:** ${REGIONS[region]}\n━━━━━━━━━━━━━━━━━━━━\nYou now have access to all channels.`);
    } catch(e) {}
    
    return { success: true, message: message };
}

// ==================== SEND BUTTON ====================
async function sendVerifyButton(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🔐 MINECRAFT VERIFICATION')
        .setDescription('Click the button below to verify your Minecraft account.\n\n**You will need:**\n• Your Minecraft username (spaces allowed for Bedrock)\n• Your game edition (java/bedrock)\n• Your device\n• Your region')
        .setColor(0x2ECC71);
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_btn')
            .setLabel('✅ VERIFY NOW')
            .setStyle(ButtonStyle.Success)
    );
    
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await msg.pin().catch(() => {});
}

// ==================== SEND REMINDERS ====================
async function sendReminders(guild) {
    const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
    if (!unverifiedRole) return;
    
    const members = await guild.members.fetch();
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(unverifiedRole.id)) {
            const last = db.lastReminder[member.id] || 0;
            if (now - last >= HOUR) {
                try {
                    await member.send(`**Reminder:** Verify your Minecraft account by clicking the button in #${VERIFY_CHANNEL}.`);
                    db.lastReminder[member.id] = now;
                    saveData();
                } catch(e) {}
            }
        }
    }
}

// ==================== COMMANDS ====================
async function registerCommands() {
    const commands = [
        { name: 'sendverify', description: '[Staff] Send verification button' },
        { name: 'notify', description: '[Staff] Send reminder to unverified members' },
        { name: 'help', description: '[Staff] Show all commands' },
        { name: 'stats', description: '[Staff] Show verification stats' },
        { name: 'forceverify', description: '[Staff] Force verify a member', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'unverify', description: '[Staff] Remove verification', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'checkign', description: '[Staff] Check member IGN', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'changedevice', description: '[Staff] Change member device', options: [{ name: 'member', type: 6, required: true }, { name: 'device', type: 3, required: true, choices: Object.entries(DEVICES).map(([val, name]) => ({ name, value: val })) }] },
        { name: 'changeregion', description: '[Staff] Change member region', options: [{ name: 'member', type: 6, required: true }, { name: 'region', type: 3, required: true, choices: Object.entries(REGIONS).map(([val, name]) => ({ name, value: val })) }] },
        { name: 'changeedition', description: '[Staff] Change member edition', options: [{ name: 'member', type: 6, required: true }, { name: 'edition', type: 3, required: true, choices: Object.entries(EDITIONS).map(([val, name]) => ({ name, value: val })) }] }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Commands registered');
}

// ==================== READY ====================
client.once('ready', async () => {
    console.log(`✅ IGN Verifier logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('❌ Guild not found!');
    
    await registerCommands();
    
    const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
    const verifiedRole = await getRole(guild, VERIFIED_ROLE);
    const members = await guild.members.fetch();
    let count = 0;
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (verifiedRole && member.roles.cache.has(verifiedRole.id)) continue;
        if (unverifiedRole && !member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.add(unverifiedRole);
            count++;
        }
    }
    
    console.log(`✅ Ready | Gave ☘️ Unverified to ${count} members`);
    console.log('📌 Staff use /sendverify in #verify');
    console.log('');
    console.log('⚠️ IMPORTANT: For nickname changes to work, the bot role must be ABOVE member roles in:');
    console.log('   Server Settings → Roles → Drag bot role to the top');
    
    setInterval(() => sendReminders(guild), 60 * 1000);
});

client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    const unverifiedRole = await getRole(member.guild, UNVERIFIED_ROLE);
    if (unverifiedRole) await member.roles.add(unverifiedRole);
});

// ==================== INTERACTION HANDLER ====================
client.on('interactionCreate', async interaction => {
    // BUTTON HANDLER
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        console.log(`🔘 ${interaction.user.tag} clicked verify button`);
        
        const verifiedRole = await getRole(interaction.guild, VERIFIED_ROLE);
        if (verifiedRole && interaction.member.roles.cache.has(verifiedRole.id)) {
            return interaction.reply({ content: '❌ You are already verified!', flags: 64 });
        }
        
        await showModal(interaction);
        return;
    }
    
    // MODAL HANDLER
    if (interaction.isModalSubmit() && interaction.customId.startsWith('verify_modal')) {
        console.log(`📝 ${interaction.user.tag} submitted verification`);
        
        let targetMember = interaction.member;
        if (interaction.customId.includes(':')) {
            const targetId = interaction.customId.split(':')[1];
            if (targetId && targetId !== interaction.user.id) {
                try { targetMember = await interaction.guild.members.fetch(targetId); } catch(e) {}
            }
        }
        
        const username = interaction.fields.getTextInputValue('username');
        const edition = interaction.fields.getTextInputValue('edition');
        const device = interaction.fields.getTextInputValue('device');
        const region = interaction.fields.getTextInputValue('region');
        
        await interaction.deferReply({ flags: 64 });
        const result = await verifyMember(targetMember, username, edition, device, region);
        await interaction.editReply({ content: result.message });
        return;
    }
    
    // SLASH COMMANDS
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, member, channel, guild } = interaction;
    const isStaff = member.permissions.has(PermissionsBitField.Flags.Administrator);
    
    if (!isStaff && commandName !== 'sendverify') {
        return interaction.reply({ content: '❌ Staff only command.', flags: 64 });
    }
    
    // /sendverify
    if (commandName === 'sendverify') {
        if (channel.name !== VERIFY_CHANNEL) {
            return interaction.reply({ content: `❌ Use in #${VERIFY_CHANNEL}`, flags: 64 });
        }
        await sendVerifyButton(channel);
        await interaction.reply({ content: '✅ Verification button sent!', flags: 64 });
    }
    
    // /notify
    else if (commandName === 'notify') {
        await interaction.reply({ content: '📨 Sending reminders...', flags: 64 });
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
    
    // /help
    else if (commandName === 'help') {
        const helpText = `**📋 STAFF COMMANDS**\n━━━━━━━━━━━━━━━━━━━━\n**/sendverify** - Send verification button\n**/notify** - DM reminder to unverified\n**/stats** - Show verification stats\n**/forceverify @user** - Force verify a member\n**/unverify @user** - Remove verification\n**/checkign @user** - Check member IGN\n**/changedevice @user device** - Change device\n**/changeregion @user region** - Change region\n**/changeedition @user edition** - Change edition\n━━━━━━━━━━━━━━━━━━━━\n**Devices:** mobile, pc, controller, playstation, switch\n**Regions:** asia, europe, america, africa, oceania\n**Editions:** java, bedrock`;
        await interaction.reply({ content: helpText, flags: 64 });
    }
    
    // /stats
    else if (commandName === 'stats') {
        const verifiedRole = await getRole(guild, VERIFIED_ROLE);
        const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
        const members = await guild.members.fetch();
        let verified = 0, unverified = 0;
        
        for (const m of members.values()) {
            if (m.user.bot) continue;
            if (verifiedRole && m.roles.cache.has(verifiedRole.id)) verified++;
            else if (unverifiedRole && m.roles.cache.has(unverifiedRole.id)) unverified++;
        }
        
        const statsText = `**📊 VERIFICATION STATS**\n━━━━━━━━━━━━━━━━━━━━\n✅ **Verified:** ${verified} members\n☘️ **Unverified:** ${unverified} members\n📝 **Total Tests:** ${Object.keys(db.users).length}\n━━━━━━━━━━━━━━━━━━━━`;
        await interaction.reply({ content: statsText, flags: 64 });
    }
    
    // /forceverify
    else if (commandName === 'forceverify') {
        const target = options.getMember('member');
        await showModal(interaction, target.id);
    }
    
    // /unverify
    else if (commandName === 'unverify') {
        const target = options.getMember('member');
        const verifiedRole = await getRole(guild, VERIFIED_ROLE);
        const playerRole = await getRole(guild, PLAYER_ROLE);
        const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
        
        if (!verifiedRole || !target.roles.cache.has(verifiedRole.id)) {
            return interaction.reply({ content: '❌ Member not verified.', flags: 64 });
        }
        
        await target.roles.remove(verifiedRole);
        if (playerRole) await target.roles.remove(playerRole);
        if (unverifiedRole) await target.roles.add(unverifiedRole);
        
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
        
        const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL);
        if (logChannel) logChannel.send(`🛠️ **${interaction.user.tag}** unverified **${target.user.tag}**`);
        
        await interaction.reply({ content: `✅ Unverified ${target.user.tag}`, flags: 64 });
    }
    
    // /checkign
    else if (commandName === 'checkign') {
        const target = options.getMember('member');
        const data = db.users[target.id];
        if (data) {
            await interaction.reply({ content: `**${target.user.tag}**\n━━━━━━━━━━━━━━━━━━━━\n**IGN:** ${data.username}\n**Edition:** ${EDITIONS[data.edition]}\n**Device:** ${DEVICES[data.device]}\n**Region:** ${REGIONS[data.region]}\n**Verified:** ${new Date(data.verifiedAt).toLocaleString()}`, flags: 64 });
        } else {
            await interaction.reply({ content: `${target.user.tag} is not verified.`, flags: 64 });
        }
    }
    
    // /changedevice
    else if (commandName === 'changedevice') {
        const target = options.getMember('member');
        const newDevice = options.getString('device');
        const data = db.users[target.id];
        if (!data) return interaction.reply({ content: '❌ Member not verified.', flags: 64 });
        
        const oldDeviceRole = await getRole(guild, DEVICES[data.device]);
        const newDeviceRole = await getRole(guild, DEVICES[newDevice]);
        
        if (oldDeviceRole && target.roles.cache.has(oldDeviceRole.id)) await target.roles.remove(oldDeviceRole);
        if (newDeviceRole) await target.roles.add(newDeviceRole);
        
        data.device = newDevice;
        saveData();
        
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s device to ${DEVICES[newDevice]}`, flags: 64 });
    }
    
    // /changeregion
    else if (commandName === 'changeregion') {
        const target = options.getMember('member');
        const newRegion = options.getString('region');
        const data = db.users[target.id];
        if (!data) return interaction.reply({ content: '❌ Member not verified.', flags: 64 });
        
        const oldRegionRole = await getRole(guild, REGIONS[data.region]);
        const newRegionRole = await getRole(guild, REGIONS[newRegion]);
        
        if (oldRegionRole && target.roles.cache.has(oldRegionRole.id)) await target.roles.remove(oldRegionRole);
        if (newRegionRole) await target.roles.add(newRegionRole);
        
        data.region = newRegion;
        saveData();
        
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s region to ${REGIONS[newRegion]}`, flags: 64 });
    }
    
    // /changeedition
    else if (commandName === 'changeedition') {
        const target = options.getMember('member');
        const newEdition = options.getString('edition');
        const data = db.users[target.id];
        if (!data) return interaction.reply({ content: '❌ Member not verified.', flags: 64 });
        
        const oldEditionRole = await getRole(guild, EDITIONS[data.edition]);
        const newEditionRole = await getRole(guild, EDITIONS[newEdition]);
        
        if (oldEditionRole && target.roles.cache.has(oldEditionRole.id)) await target.roles.remove(oldEditionRole);
        if (newEditionRole) await target.roles.add(newEditionRole);
        
        data.edition = newEdition;
        saveData();
        
        await interaction.reply({ content: `✅ Changed ${target.user.tag}'s edition to ${EDITIONS[newEdition]}`, flags: 64 });
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);