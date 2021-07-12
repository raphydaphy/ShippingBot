const Discord = require("discord.js");
const client = new Discord.Client();

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// Create an event listener for messages
client.on('message', message => {
  // If the message is "ping"
  if (message.content === 'ping') {
    // Send "pong" to the same channel
    message.channel.send('pong').then(async (message) => {
      await message.react('👍').then(() => message.react('👎'));

      console.info("done");
    });
  }
});

client.login(process.env.DISCORD_TOKEN);