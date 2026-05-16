const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
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

const VERIFY_CHANNEL = 'verify';

// ==================== MODAL WITH 4 FIELDS (Short Labels) ====================
async function showModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('test_modal')
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

// ==================== SEND BUTTON ====================
async function sendVerifyButton(channel) {
    const embed = new EmbedBuilder()
        .setTitle('🔐 MINECRAFT VERIFICATION')
        .setDescription('Click the button below to verify your Minecraft account.')
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
        { name: 'sendverify', description: '[Staff] Send verification button' }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Commands registered');
}

// ==================== READY ====================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    await registerCommands();
    console.log('✅ Ready | Staff use /sendverify in #verify');
});

// ==================== INTERACTIONS ====================
client.on('interactionCreate', async interaction => {
    // BUTTON HANDLER
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        console.log(`🔘 ${interaction.user.tag} clicked verify button`);
        await showModal(interaction);
        return;
    }
    
    // MODAL HANDLER
    if (interaction.isModalSubmit() && interaction.customId === 'test_modal') {
        const username = interaction.fields.getTextInputValue('username');
        const edition = interaction.fields.getTextInputValue('edition');
        const device = interaction.fields.getTextInputValue('device');
        const region = interaction.fields.getTextInputValue('region');
        
        console.log(`📝 ${interaction.user.tag} submitted:`);
        console.log(`   Username: ${username}`);
        console.log(`   Edition: ${edition}`);
        console.log(`   Device: ${device}`);
        console.log(`   Region: ${region}`);
        
        await interaction.reply({ 
            content: `✅ **Form Submitted Successfully!**\n━━━━━━━━━━━━━━━━━━━━\n**Username:** ${username}\n**Edition:** ${edition}\n**Device:** ${device}\n**Region:** ${region}\n━━━━━━━━━━━━━━━━━━━━\n(Full verification will be added next)`, 
            flags: 64  // ephemeral
        });
        return;
    }
    
    // SLASH COMMAND HANDLER
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, member, channel } = interaction;
    const isStaff = member.permissions.has(PermissionsBitField.Flags.Administrator);
    
    if (commandName === 'sendverify' && isStaff) {
        if (channel.name !== VERIFY_CHANNEL) {
            return interaction.reply({ content: `❌ Use in #${VERIFY_CHANNEL}`, flags: 64 });
        }
        await sendVerifyButton(channel);
        await interaction.reply({ content: '✅ Verification button sent!', flags: 64 });
    }
    else if (commandName === 'sendverify' && !isStaff) {
        await interaction.reply({ content: '❌ Staff only command.', flags: 64 });
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);