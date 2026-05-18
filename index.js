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

// Keep these for staff commands (if you still want to assign them manually)
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
let db = { users: {}, ignToUser: {}, lastReminder: {}, staffNicks: {} };
const DATA_FILE = 'verify.json';
if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e) {}
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// ==================== ROLE HELPERS ====================
async function getRole(guild, name) {
    return guild.roles.cache.find(r => r.name === name);
}

// ==================== MODAL (ONLY USERNAME) ====================
async function showModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('Minecraft Verification');
    
    const usernameInput = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('Minecraft Username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Enter your Minecraft username (Java or Bedrock)');
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(usernameInput)
    );
    
    await interaction.showModal(modal);
}

// ==================== VERIFY MEMBER (NO MOJANG CHECK - BEDROCK FRIENDLY) ====================
async function verifyMember(member, username) {
    const guild = member.guild;
    
    const verifiedRole = await getRole(guild, VERIFIED_ROLE);
    const playerRole = await getRole(guild, PLAYER_ROLE);
    const unverifiedRole = await getRole(guild, UNVERIFIED_ROLE);
    
    if (!verifiedRole || !playerRole) {
        return { success: false, message: '❌ Required roles not found. Please contact staff.' };
    }
    
    if (member.roles.cache.has(verifiedRole.id)) {
        return { success: false, message: '❌ Already verified!' };
    }
    
    // Validate username format (allows spaces for Bedrock)
    if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) {
        return { success: false, message: '❌ Invalid username. Use 3-16 letters, numbers, spaces, or underscores.' };
    }
    
    // Check if username is already taken
    if (db.ignToUser[username.toLowerCase()] && db.ignToUser[username.toLowerCase()] !== member.id) {
        return { success: false, message: '❌ This username is already verified by another member.' };
    }
    
    // NO MOJANG API CHECK - Accept any valid username (Java OR Bedrock)
    const finalUsername = username;
    
    // Change nickname to IGN
    try { await member.setNickname(finalUsername); } catch(e) {
        console.log(`Failed to set nickname: ${e.message}`);
    }
    
    // Remove unverified role if exists
    if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
        await member.roles.remove(unverifiedRole);
    }
    
    // Add verified and player roles
    await member.roles.add(verifiedRole);
    await member.roles.add(playerRole);
    
    // Save to database
    db.users[member.id] = { username: finalUsername, verifiedAt: Date.now() };
    db.ignToUser[finalUsername.toLowerCase()] = member.id;
    delete db.lastReminder[member.id];
    saveData();
    
    // Log to channel
    const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL);
    if (logChannel) {
        logChannel.send(`✅ **${member.user.tag}** verified as **${finalUsername}**`);
    }
    
    // Send welcome message
    try {
        const welcomeEmbed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setAuthor({ name: guild.name, iconURL: guild.iconURL() })
            .setTitle('🎉 VERIFICATION SUCCESSFUL!')
            .setDescription([
                `**Welcome aboard, ${member.user.username}!**`,
                '',
                'Your Minecraft account has been successfully verified.',
                '',
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                '**📋 YOUR INFORMATION**',
                `✦ **Username:** \`${finalUsername}\``,
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                '',
                '✅ You now have access to all channels',
                '⚔️ You received the `✅ Verified` and `⚔️ Player` roles',
                '',
                '**Enjoy your time in the server!** 🎮'
            ].join('\n'))
            .setFooter({ text: 'Thank you for verifying your account' })
            .setTimestamp();
        
        await member.send({ embeds: [welcomeEmbed] });
    } catch(e) {}
    
    return { success: true, message: `✅ Verified as **${finalUsername}**!` };
}

// ==================== SEND VERIFY BUTTON ====================
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
            '• Minecraft Username (Java OR Bedrock)',
            '```',
            '**⚡ WHAT YOU GET:**',
            '```',
            '• Full access to all channels',
            '• ✅ Verified role',
            '• ⚔️ Player role',
            '• Your nickname changed to your IGN',
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
    const VERIFY_CHANNEL_ID = guild.channels.cache.find(c => c.name === VERIFY_CHANNEL)?.id;
    
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(unverifiedRole.id)) {
            try {
                const reminderEmbed = {
                    color: 0xFFA500,
                    title: '🔔 VERIFICATION REMINDER',
                    description: `Please verify your Minecraft account to access **${guild.name}**.`,
                    fields: [
                        { name: '📝 How to Verify', value: `Click the **VERIFY NOW** button in <#${VERIFY_CHANNEL_ID}>`, inline: false },
                        { name: '✅ What You Get', value: 'Full access to all channels • Your IGN as nickname', inline: false }
                    ],
                    footer: { text: 'Takes less than 1 minute!' },
                    timestamp: new Date()
                };
                await member.send({ embeds: [reminderEmbed] });
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
    console.log(`📌 Commands: ${PREFIX}sendverify, ${PREFIX}notify, ${PREFIX}help, ${PREFIX}setadmin, ${PREFIX}setmod, ${PREFIX}setjrmod, ${PREFIX}sethelper, ${PREFIX}setcreator, ${PREFIX}removestaffnick`);
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
        const helpText = `**📋 STAFF COMMANDS**\n━━━━━━━━━━━━━━━━━━━━\n**${PREFIX}sendverify** - Send verification button\n**${PREFIX}notify** - DM reminder to unverified\n**${PREFIX}stats** - Show verification stats\n**${PREFIX}forceverify @user** - Force verify\n**${PREFIX}unverify @user** - Remove verification\n**${PREFIX}checkign @user** - Check IGN\n**${PREFIX}changeign @user newign** - Change IGN\n**${PREFIX}setadmin @user** - Set ADMIN • nickname\n**${PREFIX}setmod @user** - Set MODERATOR • nickname\n**${PREFIX}setjrmod @user** - Set JR MODERATOR • nickname\n**${PREFIX}sethelper @user** - Set HELPER • nickname\n**${PREFIX}setcreator @user** - Set CREATOR • nickname\n**${PREFIX}removestaffnick @user** - Remove staff nickname\n━━━━━━━━━━━━━━━━━━━━\n**Verification now accepts Java AND Bedrock usernames!**`;
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
        
        // Remove player role
        const playerRole = await getRole(guild, PLAYER_ROLE);
        if (playerRole && target.roles.cache.has(playerRole.id)) await target.roles.remove(playerRole);
        
        // Reset nickname
        try { await target.setNickname(null); } catch(e) {}
        
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
            await message.reply(`**${target.user.tag}**\nIGN: ${data.username}\nVerified: ${new Date(data.verifiedAt).toLocaleString()}`);
        } else {
            await message.reply(`${target.user.tag} is not verified.`);
        }
    }
    
    // !changeign (NO MOJANG CHECK)
    else if (command === 'changeign' && isStaff) {
        const target = message.mentions.members.first();
        const newIgn = args[1];
        
        if (!target) return message.reply('❌ Please mention a user to change IGN.');
        if (!newIgn) return message.reply('❌ Please provide the new Minecraft username.');
        
        const data = db.users[target.id];
        if (!data) return message.reply('❌ Member not verified.');
        
        if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(newIgn)) {
            return message.reply('❌ Invalid username. Use 3-16 letters, numbers, spaces, or underscores.');
        }
        
        const oldIgn = data.username;
        const oldIgnLower = oldIgn.toLowerCase();
        
        if (db.ignToUser[newIgn.toLowerCase()] && db.ignToUser[newIgn.toLowerCase()] !== target.id) {
            return message.reply('❌ This username is already verified by another member.');
        }
        
        // NO MOJANG CHECK - Accept any valid username
        
        delete db.ignToUser[oldIgnLower];
        db.ignToUser[newIgn.toLowerCase()] = target.id;
        data.username = newIgn;
        saveData();
        
        try {
            await target.setNickname(newIgn);
            await message.reply(`✅ Changed ${target.user.tag}'s IGN from **${oldIgn}** to **${newIgn}**`);
            
            const logChannel = message.guild.channels.cache.find(c => c.name === LOG_CHANNEL);
            if (logChannel) {
                logChannel.send(`🛠️ **${message.author.tag}** changed ${target.user.tag}'s IGN from ${oldIgn} to ${newIgn}`);
            }
            
            try {
                await target.send(`🔧 **Your Minecraft username has been updated!**\n━━━━━━━━━━━━━━━━━━━━\n**Old IGN:** ${oldIgn}\n**New IGN:** ${newIgn}\n\nYour nickname has been updated accordingly.`);
            } catch(e) {}
            
        } catch(e) {
            await message.reply(`✅ Database updated but failed to change nickname: ${e.message}`);
        }
    }
    
    // ==================== STAFF NICKNAME COMMANDS ====================
    
    else if (command === 'setadmin') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Please mention a user.');
        
        let currentName = target.nickname || target.user.username;
        currentName = currentName.replace(/^(ADMIN • |MODERATOR • |HELPER • |JR MODERATOR • |CREATOR • )/, '');
        const newNick = `ADMIN • ${currentName}`;
        
        try {
            await target.setNickname(newNick);
            await message.reply(`✅ Set ${target.user.tag}'s nickname to **${newNick}**`);
            
            db.staffNicks[target.id] = { role: 'ADMIN', nickname: newNick };
            saveData();
            
            const logChannel = message.guild.channels.cache.find(c => c.name === LOG_CHANNEL);
            if (logChannel) logChannel.send(`🛠️ **${message.author.tag}** set ${target.user.tag}'s staff nickname to ${newNick}`);
        } catch(e) {
            await message.reply(`❌ Failed: ${e.message}`);
        }
    }
    
    else if (command === 'setmod') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Please mention a user.');
        
        let currentName = target.nickname || target.user.username;
        currentName = currentName.replace(/^(ADMIN • |MODERATOR • |HELPER • |JR MODERATOR • |CREATOR • )/, '');
        const newNick = `MODERATOR • ${currentName}`;
        
        try {
            await target.setNickname(newNick);
            await message.reply(`✅ Set ${target.user.tag}'s nickname to **${newNick}**`);
            
            db.staffNicks[target.id] = { role: 'MODERATOR', nickname: newNick };
            saveData();
            
            const logChannel = message.guild.channels.cache.find(c => c.name === LOG_CHANNEL);
            if (logChannel) logChannel.send(`🛠️ **${message.author.tag}** set ${target.user.tag}'s staff nickname to ${newNick}`);
        } catch(e) {
            await message.reply(`❌ Failed: ${e.message}`);
        }
    }
    
    else if (command === 'setjrmod') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Please mention a user.');
        
        let currentName = target.nickname || target.user.username;
        currentName = currentName.replace(/^(ADMIN • |MODERATOR • |HELPER • |JR MODERATOR • |CREATOR • )/, '');
        const newNick = `JR MODERATOR • ${currentName}`;
        
        try {
            await target.setNickname(newNick);
            await message.reply(`✅ Set ${target.user.tag}'s nickname to **${newNick}**`);
            
            db.staffNicks[target.id] = { role: 'JR_MODERATOR', nickname: newNick };
            saveData();
            
            const logChannel = message.guild.channels.cache.find(c => c.name === LOG_CHANNEL);
            if (logChannel) logChannel.send(`🛠️ **${message.author.tag}** set ${target.user.tag}'s staff nickname to ${newNick}`);
        } catch(e) {
            await message.reply(`❌ Failed: ${e.message}`);
        }
    }
    
    else if (command === 'sethelper') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Please mention a user.');
        
        let currentName = target.nickname || target.user.username;
        currentName = currentName.replace(/^(ADMIN • |MODERATOR • |HELPER • |JR MODERATOR • |CREATOR • )/, '');
        const newNick = `HELPER • ${currentName}`;
        
        try {
            await target.setNickname(newNick);
            await message.reply(`✅ Set ${target.user.tag}'s nickname to **${newNick}**`);
            
            db.staffNicks[target.id] = { role: 'HELPER', nickname: newNick };
            saveData();
            
            const logChannel = message.guild.channels.cache.find(c => c.name === LOG_CHANNEL);
            if (logChannel) logChannel.send(`🛠️ **${message.author.tag}** set ${target.user.tag}'s staff nickname to ${newNick}`);
        } catch(e) {
            await message.reply(`❌ Failed: ${e.message}`);
        }
    }
    
    else if (command === 'setcreator') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Please mention a user.');
        
        let currentName = target.nickname || target.user.username;
        currentName = currentName.replace(/^(ADMIN • |MODERATOR • |HELPER • |JR MODERATOR • |CREATOR • )/, '');
        const newNick = `CREATOR • ${currentName}`;
        
        try {
            await target.setNickname(newNick);
            await message.reply(`✅ Set ${target.user.tag}'s nickname to **${newNick}**`);
            
            db.staffNicks[target.id] = { role: 'CREATOR', nickname: newNick };
            saveData();
            
            const logChannel = message.guild.channels.cache.find(c => c.name === LOG_CHANNEL);
            if (logChannel) logChannel.send(`🛠️ **${message.author.tag}** set ${target.user.tag}'s staff nickname to ${newNick}`);
        } catch(e) {
            await message.reply(`❌ Failed: ${e.message}`);
        }
    }
    
    else if (command === 'removestaffnick') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ Please mention a user.');
        
        let currentName = target.nickname || target.user.username;
        const cleanName = currentName.replace(/^(ADMIN • |MODERATOR • |HELPER • |JR MODERATOR • |CREATOR • )/, '');
        
        try {
            await target.setNickname(cleanName);
            await message.reply(`✅ Removed staff nickname from ${target.user.tag}, nickname is now **${cleanName}**`);
            
            if (db.staffNicks) delete db.staffNicks[target.id];
            saveData();
            
            const logChannel = message.guild.channels.cache.find(c => c.name === LOG_CHANNEL);
            if (logChannel) logChannel.send(`🛠️ **${message.author.tag}** removed staff nickname from ${target.user.tag}`);
        } catch(e) {
            await message.reply(`❌ Failed: ${e.message}`);
        }
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
        
        await interaction.deferReply({ flags: 64 });
        const result = await verifyMember(interaction.member, username);
        await interaction.editReply({ content: result.message });
        return;
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);