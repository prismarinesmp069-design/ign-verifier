const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN = process.env.IGN_TOKEN;
const CLIENT_ID = process.env.IGN_CLIENT_ID;
const GUILD_ID = process.env.IGN_GUILD_ID;

// Simple verification data
const verifiedUsers = new Map();

client.once('ready', async () => {
    console.log(`✅ Bot online as ${client.user.tag}`);
    
    // Register commands
    const commands = [
        { name: 'verifybtn', description: 'Send verification button (Staff only)' }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered');
});

// Send verification button
async function sendVerifyButton(channel) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_btn')
            .setLabel('✅ VERIFY NOW')
            .setStyle(ButtonStyle.Success)
    );
    
    await channel.send({
        content: '## 🔐 MINECRAFT VERIFICATION\nClick the button below to verify your account.',
        components: [row]
    });
}

// Handle button clicks
client.on('interactionCreate', async interaction => {
    // Handle button
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
        console.log(`Button clicked by ${interaction.user.tag}`);
        
        // Create modal
        const modal = new ModalBuilder()
            .setCustomId('verify_modal')
            .setTitle('Verify Your Account');
        
        const ignInput = new TextInputBuilder()
            .setCustomId('ign')
            .setLabel('Minecraft Username')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Enter your Minecraft username');
        
        modal.addComponents(new ActionRowBuilder().addComponents(ignInput));
        
        await interaction.showModal(modal);
    }
    
    // Handle modal submission
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        const ign = interaction.fields.getTextInputValue('ign');
        console.log(`Modal submitted by ${interaction.user.tag} with IGN: ${ign}`);
        
        // Store verification
        verifiedUsers.set(interaction.user.id, ign);
        
        // Try to change nickname
        try {
            await interaction.member.setNickname(ign);
        } catch(e) {
            console.log('Could not change nickname - bot role may be too low');
        }
        
        await interaction.reply({
            content: `✅ **Successfully verified as ${ign}!**\nYou now have access to the server.`,
            ephemeral: true
        });
    }
    
    // Handle slash command
    if (interaction.isCommand() && interaction.commandName === 'verifybtn') {
        // Check if staff
        const isStaff = interaction.member.permissions.has('Administrator');
        if (!isStaff) {
            return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
        }
        
        await interaction.deferReply({ ephemeral: true });
        await sendVerifyButton(interaction.channel);
        await interaction.editReply({ content: '✅ Verification button sent!' });
    }
});

client.login(TOKEN);