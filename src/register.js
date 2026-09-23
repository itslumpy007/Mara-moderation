import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
for (const key of ['DISCORD_TOKEN','CLIENT_ID','GUILD_ID']) if (!process.env[key]) throw new Error(`Missing ${key}`);
await new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID), {body:commands});
console.log('Mara commands registered for the configured server.');
