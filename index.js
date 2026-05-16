const { Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
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
const GUILD_ID = process.env.IGN_GUILD_ID;

// ==================== CONFIGURATION ====================
const PREFIX = '!';
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
async function showModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('verify_modal')
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
    delete db.lastReminder[member.id];
    saveData();
    
    const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL);
    if (logChannel) {
        logChannel.send(`✅ **${member.user.tag}** verified as **${finalUsername}**`);
    }
    
    try {
        await member.send(`✅ **Welcome!** Verified as **${finalUsername}**`);
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${finalUsername}**!` };
}

// ==================== SEND BUTTON (PROFESSIONAL WITH SERVER ICON) ====================
async function sendVerifyButton(channel) {
    const guild = channel.guild;
    const serverIcon = guild.iconURL({ dynamic: true, size: 256 });
    
    const embed = new EmbedBuilder()
        .setTitle(`🔐 ${guild.name} - Verification`)
        .setDescription([
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            '**✅ Click the button below to verify your Minecraft account**',
            '',
            '**📋 WHAT YOU NEED:**',
            '```',
            '• Minecraft Username',
            '• Game Edition (Java / Bedrock)',
            '• Device (Mobile / PC / Controller / PlayStation / Switch)',
            '• Region (Asia / Europe / America / Africa / Oceania)',
            '```',
            '**⚡ WHAT YOU GET:**',
            '```',
            '• Full access to all channels',
            '• ✅ Verified role',
            '• ⚔️ Player role',
            '• Edition, Device & Region roles',
            '```',
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            '*Verification ensures a safe and secure community*'
        ].join('\n'))
        .setColor(0x2ECC71)
        .setThumbnail(serverIcon)
        .setFooter({ text: `${guild.name} | Verification System`, iconURL: serverIcon })
        .setTimestamp();
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_btn')
            .setLabel('✅ VERIFY NOW')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
    );
    
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await msg.pin().catch(() => {});
}

// ==================== NOTIFY UNVERIFIED ====================
async function notifyUnverified(guild, message) {
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
    
    await message.reply(`✅ Sent reminders to ${count} members.`);
    return count;
}

// ==================== READY ====================
client.once('ready', async () => {
    console.log(`✅ IGN Verifier logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('❌ Guild not found!');
    
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
    console.log(`📌 Commands: ${PREFIX}verify, ${PREFIX}sendverify, ${PREFIX}notify, ${PREFIX}help`);
});

client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
    const unverifiedRole = await getRole(member.guild, UNVERIFIED_ROLE);
    if (unverifiedRole) await member.roles.add(unverifiedRole);
});

// ==================== MESSAGE HANDLER ====================
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const guild = message.guild;
    const member = message.member;
    const channel = message.channel;
    
    const isStaff = member.permissions.has(PermissionsBitField.Flags.Administrator);
    
    // !sendverify
    if (command === 'sendverify' && isStaff) {
        if (channel.name !== VERIFY_CHANNEL) {
            return message.reply(`❌ Use this command in #${VERIFY_CHANNEL}`);
        }
        await sendVerifyButton(channel);
        await message.reply('✅ Verification button sent!');
    }
    
    // !notify
    else if (command === 'notify' && isStaff) {
        await message.reply('📨 Sending reminders...');
        await notifyUnverified(guild, message);
    }
    
    // !help
    else if (command === 'help' && isStaff) {
        const helpText = `**📋 STAFF COMMANDS**\n━━━━━━━━━━━━━━━━━━━━\n**${PREFIX}sendverify** - Send verification button\n**${PREFIX}notify** - DM reminder to unverified\n**${PREFIX}stats** - Show verification stats\n**${PREFIX}forceverify @user** - Force verify\n**${PREFIX}unverify @user** - Remove verification\n**${PREFIX}checkign @user** - Check IGN\n**${PREFIX}changedevice @user device** - Change device\n**${PREFIX}changeregion @user region** - Change region\n**${PREFIX}changeedition @user edition** - Change edition\n━━━━━━━━━━━━━━━━━━━━\n**Devices:** mobile, pc, controller, playstation, switch\n**Regions:** asia, europe, america, africa, oceania\n**Editions:** java, bedrock`;
        await message.reply(helpText);
    }
    
    // !stats
    else if (command === 'stats' && isStaff) {
        const verifiedRole = await getRole(guild, VERIFIED_ROLE);
        const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
        const members = await guild.members.fetch();
        let verified = 0, unverified = 0;
        
        for (const m of members.values()) {
            if (m.user.bot) continue;
            if (verifiedRole && m.roles.cache.has(verifiedRole.id)) verified++;
            else if (unverifiedRole && m.roles.cache.has(unverifiedRole.id)) unverified++;
        }
        
        await message.reply(`**📊 VERIFICATION STATS**\n✅ Verified: ${verified}\n☘️ Unverified: ${unverified}\n📝 Total Tests: ${Object.keys(db.users).length}`);
    }
    
    // !forceverify
    else if (command === 'forceverify' && isStaff) {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Please mention a user to force verify.');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`force_verify:${target.id}`)
                .setLabel('Click to Verify')
                .setStyle(ButtonStyle.Primary)
        );
        
        await message.reply({ content: `Click below to verify ${target.user.tag}:`, components: [row] });
    }
    
    // !unverify
    else if (command === 'unverify' && isStaff) {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Please mention a user to unverify.');
        
        const verifiedRole = await getRole(guild, VERIFIED_ROLE);
        const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
        
        if (!target.roles.cache.has(verifiedRole.id)) {
            return message.reply('❌ Member not verified.');
        }
        
        await target.roles.remove(verifiedRole);
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
        
        delete db.users[target.id];
        saveData();
        
        await message.reply(`✅ Unverified ${target.user.tag}`);
    }
    
    // !checkign
    else if (command === 'checkign' && isStaff) {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Please mention a user to check.');
        
        const data = db.users[target.id];
        if (data) {
            await message.reply(`**${target.user.tag}**\nIGN: ${data.username}\nEdition: ${EDITIONS[data.edition]}\nDevice: ${DEVICES[data.device]}\nRegion: ${REGIONS[data.region]}`);
        } else {
            await message.reply(`${target.user.tag} is not verified.`);
        }
    }
    
    // !changedevice
    else if (command === 'changedevice' && isStaff) {
        const target = message.mentions.members.first();
        const newDevice = args[1];
        if (!target || !newDevice) return message.reply('❌ Usage: !changedevice @user device');
        
        const data = db.users[target.id];
        if (!data) return message.reply('❌ Member not verified.');
        
        const oldDeviceRole = await getRole(guild, DEVICES[data.device]);
        const newDeviceRole = await getRole(guild, DEVICES[newDevice]);
        
        if (oldDeviceRole && target.roles.cache.has(oldDeviceRole.id)) await target.roles.remove(oldDeviceRole);
        if (newDeviceRole) await target.roles.add(newDeviceRole);
        
        data.device = newDevice;
        saveData();
        
        await message.reply(`✅ Changed ${target.user.tag}'s device to ${DEVICES[newDevice]}`);
    }
    
    // !changeregion
    else if (command === 'changeregion' && isStaff) {
        const target = message.mentions.members.first();
        const newRegion = args[1];
        if (!target || !newRegion) return message.reply('❌ Usage: !changeregion @user region');
        
        const data = db.users[target.id];
        if (!data) return message.reply('❌ Member not verified.');
        
        const oldRegionRole = await getRole(guild, REGIONS[data.region]);
        const newRegionRole = await getRole(guild, REGIONS[newRegion]);
        
        if (oldRegionRole && target.roles.cache.has(oldRegionRole.id)) await target.roles.remove(oldRegionRole);
        if (newRegionRole) await target.roles.add(newRegionRole);
        
        data.region = newRegion;
        saveData();
        
        await message.reply(`✅ Changed ${target.user.tag}'s region to ${REGIONS[newRegion]}`);
    }
    
    // !changeedition
    else if (command === 'changeedition' && isStaff) {
        const target = message.mentions.members.first();
        const newEdition = args[1];
        if (!target || !newEdition) return message.reply('❌ Usage: !changeedition @user edition');
        
        const data = db.users[target.id];
        if (!data) return message.reply('❌ Member not verified.');
        
        const oldEditionRole = await getRole(guild, EDITIONS[data.edition]);
        const newEditionRole = await getRole(guild, EDITIONS[newEdition]);
        
        if (oldEditionRole && target.roles.cache.has(oldEditionRole.id)) await target.roles.remove(oldEditionRole);
        if (newEditionRole) await target.roles.add(newEditionRole);
        
        data.edition = newEdition;
        saveData();
        
        await message.reply(`✅ Changed ${target.user.tag}'s edition to ${EDITIONS[newEdition]}`);
    }
});

// ==================== BUTTON HANDLER ====================
client.on('interactionCreate', async interaction => {
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        await showModal(interaction);
        return;
    }
    
    if (interaction.isButton() && interaction.customId.startsWith('force_verify:')) {
        const targetId = interaction.customId.split(':')[1];
        const target = await interaction.guild.members.fetch(targetId);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_btn')
                .setLabel('✅ VERIFY NOW')
                .setStyle(ButtonStyle.Success)
        );
        
        await interaction.reply({ content: `Starting verification for ${target.user.tag}. Click below:`, components: [row], ephemeral: true });
        return;
    }
    
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        const username = interaction.fields.getTextInputValue('username');
        const edition = interaction.fields.getTextInputValue('edition');
        const device = interaction.fields.getTextInputValue('device');
        const region = interaction.fields.getTextInputValue('region');
        
        await interaction.deferReply({ flags: 64 });
        const result = await verifyMember(interaction.member, username, edition, device, region);
        await interaction.editReply({ content: result.message });
        return;
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);