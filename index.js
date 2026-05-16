const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const express = require('express');

// Keep-alive server
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(3000, () => console.log('🌐 Server on port 3000'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN = process.env.IGN_TOKEN;
const CLIENT_ID = process.env.IGN_CLIENT_ID;
const GUILD_ID = process.env.IGN_GUILD_ID;

// Simple command
async function registerCommands() {
    const commands = [
        { name: 'ping', description: 'Replies with pong!' }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Commands registered');
}

client.once('ready', async () => {
    console.log(`✅ Bot online as ${client.user.tag}`);
    await registerCommands();
    console.log('Type /ping in Discord');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong! 🏓');
    }
});

client.login(TOKEN);