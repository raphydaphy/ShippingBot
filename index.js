const Discord = require("discord.js");
const client = new Discord.Client({partials: ["MESSAGE", "CHANNEL", "REACTION"]});

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on("messageReactionAdd", async (reaction, user) => {
  // When a reaction is received, check if the structure is partial
  if (reaction.partial) {
    // If the message this reaction belongs to was removed, the fetching might result in an API error which should be handled
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Something went wrong when fetching the message: ', error);
      // Return as `reaction.message.author` may be undefined/null
      return;
    }
  }

  // We only want to listen to reactions on our own messages that aren't by us
  if (user.id === client.user.id || reaction.message.author.id !== client.user.id) return;

  await reaction.users.remove(user);

  user.send("Thanks for reacting with " + reaction.emoji.toString());

  // Now the message has been cached and is fully available
  console.log(`${reaction.message.author}'s message "${reaction.message.content}" gained a reaction!`);
  // The reaction is now also fully available and the properties will be reflected accurately:
  console.log(`${reaction.count} user(s) have given the same reaction to this message!`);
})

// Create an event listener for messages
client.on('message', message => {
  // If the message is "ping"
  if (message.content === '!shipping') {

    message.delete();

    // Send "pong" to the same channel
    message.channel.send('React to this message to create a shipping label').then((message) => {
      message.react('👍').then(() => message.react('👎'));
    });
  }
});

client.login(process.env.DISCORD_TOKEN);