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
        .setPlaceholder('Enter your Minecraft username');
    
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
async function verifyMember(member, username, edition, device, region) {
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
    } catch(e) {
        console.log(`Nickname change failed: ${e.message}`);
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
    
    try {
        await member.send(`✅ **Welcome to ${guild.name}!**\n━━━━━━━━━━━━━━━━━━━━\n**Username:** ${finalUsername}\n**Edition:** ${EDITIONS[edition]}\n**Device:** ${DEVICES[device]}\n**Region:** ${REGIONS[region]}\n━━━━━━━━━━━━━━━━━━━━\nYou now have access to all channels.`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${finalUsername}**!` };
}

// ==================== SEND BUTTON ====================
async function sendVerifyButton(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🔐 MINECRAFT VERIFICATION')
        .setDescription('Click the button below to verify your Minecraft account.\n\n**You will need:**\n• Your Minecraft username\n• Your game edition (java/bedrock)\n• Your device\n• Your region')
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

// ==================== NOTIFY UNVERIFIED ====================
async function notifyUnverified(guild, interaction = null) {
    const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
    if (!unverifiedRole) return 0;
    
    const members = await guild.members.fetch();
    let count = 0;
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(unverifiedRole.id)) {
            try {
                await member.send(`**🔐 Verification Required**\nClick the button in #${VERIFY_CHANNEL} to verify your Minecraft account.`);
                count++;
                await new Promise(r => setTimeout(r, 500));
            } catch(e) {}
        }
    }
    
    if (interaction) {
        await interaction.editReply({ content: `✅ Sent reminders to ${count} members.` });
    }
    return count;
}

// ==================== COMMANDS ====================
async function registerCommands() {
    const commands = [
        { name: 'sendverify', description: 'Send verification button' },
        { name: 'notify', description: 'Send reminder to unverified members' },
        { name: 'help', description: 'Show all commands' },
        { name: 'stats', description: 'Show verification stats' },
        { name: 'forceverify', description: 'Force verify a member', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'unverify', description: 'Remove verification', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'checkign', description: 'Check member IGN', options: [{ name: 'member', type: 6, required: true }] },
        { name: 'changedevice', description: 'Change member device', options: [{ name: 'member', type: 6, required: true }, { name: 'device', type: 3, required: true, choices: Object.entries(DEVICES).map(([val, name]) => ({ name, value: val })) }] },
        { name: 'changeregion', description: 'Change member region', options: [{ name: 'member', type: 6, required: true }, { name: 'region', type: 3, required: true, choices: Object.entries(REGIONS).map(([val, name]) => ({ name, value: val })) }] },
        { name: 'changeedition', description: 'Change member edition', options: [{ name: 'member', type: 6, required: true }, { name: 'edition', type: 3, required: true, choices: Object.entries(EDITIONS).map(([val, name]) => ({ name, value: val })) }] }
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
    
    if (!isStaff) {
        return interaction.reply({ content: '❌ Staff only command.', flags: 64 });
    }
    
    switch(commandName) {
        case 'sendverify':
            if (channel.name !== VERIFY_CHANNEL) {
                return interaction.reply({ content: `❌ Use in #${VERIFY_CHANNEL}`, flags: 64 });
            }
            await sendVerifyButton(channel);
            await interaction.reply({ content: '✅ Verification button sent!', flags: 64 });
            break;
            
        case 'notify':
            await interaction.deferReply({ flags: 64 });
            await notifyUnverified(guild, interaction);
            break;
            
        case 'help':
            const helpText = `**📋 STAFF COMMANDS**\n━━━━━━━━━━━━━━━━━━━━\n**/sendverify** - Send verification button\n**/notify** - DM reminder to unverified\n**/stats** - Show verification stats\n**/forceverify @user** - Force verify\n**/unverify @user** - Remove verification\n**/checkign @user** - Check IGN\n**/changedevice @user device** - Change device\n**/changeregion @user region** - Change region\n**/changeedition @user edition** - Change edition\n━━━━━━━━━━━━━━━━━━━━\n**Devices:** mobile, pc, controller, playstation, switch\n**Regions:** asia, europe, america, africa, oceania\n**Editions:** java, bedrock`;
            await interaction.reply({ content: helpText, flags: 64 });
            break;
            
        case 'stats':
            const verifiedRole = await getRole(guild, VERIFIED_ROLE);
            const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
            const members = await guild.members.fetch();
            let verified = 0, unverified = 0;
            
            for (const m of members.values()) {
                if (m.user.bot) continue;
                if (verifiedRole && m.roles.cache.has(verifiedRole.id)) verified++;
                else if (unverifiedRole && m.roles.cache.has(unverifiedRole.id)) unverified++;
            }
            
            await interaction.reply({ content: `**📊 VERIFICATION STATS**\n━━━━━━━━━━━━━━━━━━━━\n✅ **Verified:** ${verified}\n☘️ **Unverified:** ${unverified}\n📝 **Total Tests:** ${Object.keys(db.users).length}`, flags: 64 });
            break;
            
        case 'forceverify':
            const target = options.getMember('member');
            await showModal(interaction, target.id);
            break;
            
        case 'unverify':
            const targetUnverify = options.getMember('member');
            const vRole = await getRole(guild, VERIFIED_ROLE);
            const uvRole = await getRole(guild, UNVERIFIED_ROLE);
            
            if (!targetUnverify.roles.cache.has(vRole.id)) {
                return interaction.reply({ content: '❌ Member not verified.', flags: 64 });
            }
            
            await targetUnverify.roles.remove(vRole);
            if (uvRole) await targetUnverify.roles.add(uvRole);
            
            for (const [key, name] of Object.entries(EDITIONS)) {
                const role = await getRole(guild, name);
                if (role && targetUnverify.roles.cache.has(role.id)) await targetUnverify.roles.remove(role);
            }
            for (const [key, name] of Object.entries(DEVICES)) {
                const role = await getRole(guild, name);
                if (role && targetUnverify.roles.cache.has(role.id)) await targetUnverify.roles.remove(role);
            }
            for (const [key, name] of Object.entries(REGIONS)) {
                const role = await getRole(guild, name);
                if (role && targetUnverify.roles.cache.has(role.id)) await targetUnverify.roles.remove(role);
            }
            
            delete db.users[targetUnverify.id];
            saveData();
            
            await interaction.reply({ content: `✅ Unverified ${targetUnverify.user.tag}`, flags: 64 });
            break;
            
        case 'checkign':
            const targetCheck = options.getMember('member');
            const data = db.users[targetCheck.id];
            if (data) {
                await interaction.reply({ content: `**${targetCheck.user.tag}**\n━━━━━━━━━━━━━━━━━━━━\n**IGN:** ${data.username}\n**Edition:** ${EDITIONS[data.edition]}\n**Device:** ${DEVICES[data.device]}\n**Region:** ${REGIONS[data.region]}`, flags: 64 });
            } else {
                await interaction.reply({ content: `${targetCheck.user.tag} is not verified.`, flags: 64 });
            }
            break;
            
        case 'changedevice':
            const targetDevice = options.getMember('member');
            const newDevice = options.getString('device');
            const deviceData = db.users[targetDevice.id];
            if (!deviceData) return interaction.reply({ content: '❌ Member not verified.', flags: 64 });
            
            const oldDevice = await getRole(guild, DEVICES[deviceData.device]);
            const newDeviceRole = await getRole(guild, DEVICES[newDevice]);
            
            if (oldDevice && targetDevice.roles.cache.has(oldDevice.id)) await targetDevice.roles.remove(oldDevice);
            if (newDeviceRole) await targetDevice.roles.add(newDeviceRole);
            
            deviceData.device = newDevice;
            saveData();
            await interaction.reply({ content: `✅ Changed ${targetDevice.user.tag}'s device to ${DEVICES[newDevice]}`, flags: 64 });
            break;
            
        case 'changeregion':
            const targetRegion = options.getMember('member');
            const newRegion = options.getString('region');
            const regionData = db.users[targetRegion.id];
            if (!regionData) return interaction.reply({ content: '❌ Member not verified.', flags: 64 });
            
            const oldRegion = await getRole(guild, REGIONS[regionData.region]);
            const newRegionRole = await getRole(guild, REGIONS[newRegion]);
            
            if (oldRegion && targetRegion.roles.cache.has(oldRegion.id)) await targetRegion.roles.remove(oldRegion);
            if (newRegionRole) await targetRegion.roles.add(newRegionRole);
            
            regionData.region = newRegion;
            saveData();
            await interaction.reply({ content: `✅ Changed ${targetRegion.user.tag}'s region to ${REGIONS[newRegion]}`, flags: 64 });
            break;
            
        case 'changeedition':
            const targetEdition = options.getMember('member');
            const newEdition = options.getString('edition');
            const editionData = db.users[targetEdition.id];
            if (!editionData) return interaction.reply({ content: '❌ Member not verified.', flags: 64 });
            
            const oldEdition = await getRole(guild, EDITIONS[editionData.edition]);
            const newEditionRole = await getRole(guild, EDITIONS[newEdition]);
            
            if (oldEdition && targetEdition.roles.cache.has(oldEdition.id)) await targetEdition.roles.remove(oldEdition);
            if (newEditionRole) await targetEdition.roles.add(newEditionRole);
            
            editionData.edition = newEdition;
            saveData();
            await interaction.reply({ content: `✅ Changed ${targetEdition.user.tag}'s edition to ${EDITIONS[newEdition]}`, flags: 64 });
            break;
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);