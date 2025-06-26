import discord
from discord.ext import commands
import asyncio
import json
import os
from utils.logger import setup_logger
from utils.database import Database

# Load Opus for voice functionality
if not discord.opus.is_loaded():
    try:
        import glob
        import ctypes.util

        # First try system discovery
        opus_path = ctypes.util.find_library('opus')
        if opus_path:
            discord.opus.load_opus(opus_path)
            print(f"Successfully loaded Opus from: {opus_path}")
        else:
            # Try the specific Nix store path found via pkg-config
            nix_opus_path = '/nix/store/mxg79hhk4dgv0lnifhj6k9jgk7xrkcsd-libopus-1.5.2/lib/libopus.so.0'
            try:
                discord.opus.load_opus(nix_opus_path)
                print(f"Successfully loaded Opus from: {nix_opus_path}")
            except:
                # Search in Nix store for libopus
                nix_opus_paths = glob.glob('/nix/store/*/lib/libopus.so*')
                for path in nix_opus_paths:
                    try:
                        discord.opus.load_opus(path)
                        print(f"Successfully loaded Opus from: {path}")
                        break
                    except:
                        continue
            else:
                # Try common fallback paths
                fallback_paths = [
                    'libopus.so.0', 'libopus.so', 'opus',
                    '/usr/lib/x86_64-linux-gnu/libopus.so.0',
                    '/usr/lib/libopus.so.0'
                ]
                for opus_lib in fallback_paths:
                    try:
                        discord.opus.load_opus(opus_lib)
                        print(f"Successfully loaded Opus from: {opus_lib}")
                        break
                    except:
                        continue
                else:
                    print("Warning: Could not load Opus library")
                    print(
                        "Music playback will not work. Bot will continue with other features."
                    )
    except Exception as e:
        print(f"Warning: Error loading Opus library: {e}")
        print(
            "Music playback will not work. Bot will continue with other features."
        )

# Set up intents
intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True
intents.guilds = True
intents.members = True


# Initialize bot
class DiscordBot(commands.Bot):

    def __init__(self):
        super().__init__(command_prefix='!',
                         intents=intents,
                         help_command=None)
        self.logger = setup_logger()
        self.db = Database()
        
        # Load bot configuration
        try:
            with open('config/settings.json', 'r') as f:
                self.config = json.load(f)
        except FileNotFoundError:
            self.config = {
                "bot_name": "Better Cheez",
                "version": "1.0.0",
                "description": "A multi-purpose Discord bot with moderation, music, embeds, QOTD, and soundboard features",
                "support_guild_id": 1386703248781475986
            }

    async def setup_hook(self):
        """Load all cogs and sync commands"""
        try:
            # Load all cogs
            cogs = [
                'cogs.moderation', 'cogs.music', 'cogs.embeds', 'cogs.qotd',
                'cogs.soundboard', 'cogs.fun', 'cogs.automod',
                'cogs.welcome'
            ]
            for cog in cogs:
                await self.load_extension(cog)
                self.logger.info(f"Loaded {cog}")

            # Sync slash commands
            try:
                synced = await self.tree.sync()
                self.logger.info(f"Synced {len(synced)} command(s)")

                # Log all synced commands for debugging
                for cmd in synced:
                    self.logger.info(f"  - {cmd.name}: {cmd.description}")

            except Exception as e:
                self.logger.error(f"Command sync failed: {e}")

        except Exception as e:
            self.logger.error(f"Error in setup_hook: {e}")

    async def on_ready(self):
        """Bot ready event"""
        self.logger.info(f'{self.user} has connected to Discord!')
        self.logger.info(f'Bot is in {len(self.guilds)} guilds')

        # Set bot status
        await self.change_presence(activity=discord.Activity(
            type=discord.ActivityType.listening, name="/help for commands"))
        
        # Log support guild info
        support_guild_id = self.config.get("support_guild_id") or self.config.get("bot_settings", {}).get("support_guild_id")
        if support_guild_id:
            support_guild = self.get_guild(support_guild_id)
            if support_guild:
                self.logger.info(f"Support guild: {support_guild.name} ({support_guild_id})")
            else:
                self.logger.warning(f"Support guild with ID {support_guild_id} not found")

    async def on_guild_join(self, guild):
        """Initialize guild settings when bot joins a server"""
        self.db.initialize_guild(guild.id)
        self.logger.info(f"Joined guild: {guild.name} ({guild.id})")

    async def on_command_error(self, ctx, error):
        """Global error handler"""
        if isinstance(error, commands.CommandNotFound):
            return
        elif isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ You don't have permission to use this command.")
        elif isinstance(error, commands.BotMissingPermissions):
            await ctx.send(
                "❌ I don't have the required permissions to execute this command."
            )
        else:
            self.logger.error(f"Unhandled error: {error}")
            await ctx.send("❌ An unexpected error occurred.")


# Initialize and run bot
async def main():
    bot = DiscordBot()

    # Get token from environment variable
    token = os.getenv('DISCORD_TOKEN')
    if not token:
        print("❌ DISCORD_TOKEN environment variable not found!")
        return

    try:
        await bot.start(token)
    except KeyboardInterrupt:
        await bot.close()
    except Exception as e:
        print(f"❌ Error starting bot: {e}")


if __name__ == "__main__":
    asyncio.run(main())
