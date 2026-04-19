const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits, 
    ChannelType,
    Partials,
    MessageFlags
} = require('discord.js');
const http = require('http');
const ms = require('ms');

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive!');
});
server.listen(8000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages 
    ],
    partials: [Partials.Channel] 
});

// ギブアウェイ設定と当選者データを保持
const giveawaySettings = new Map(); // [guildId]: { logChannelId, proofChannelId }
const giveawayWinners = new Map();

client.once('ready', async () => {
    console.log(`${client.user.tag} が正常に起動しました！`);
    
    const commands = [
        {
            name: 'gs',
            description: 'ギブアウェイを開始します',
            default_member_permissions: PermissionFlagsBits.Administrator.toString(),
            options: [
                { name: 'title', description: '景品名', type: 3, required: true },
                { name: 'description', description: '詳細', type: 3, required: true },
                { name: 'time', description: '期間 (10s, 1m, 1h)', type: 3, required: true },
                { name: 'number', description: '当選人数', type: 4, required: true },
                { name: 'log', description: 'ログ送信先チャンネル', type: 7, channel_types: [0], required: true },
                { name: 'proof', description: '証拠写真送信先チャンネル', type: 7, channel_types: [0], required: true },
                { name: 'sponsor', description: 'スポンサー', type: 3, required: false },
            ]
        },
        {
            name: 'claim',
            description: '当選した景品を申請します',
            options: [
                { name: 'content', description: '受取対象を選択', type: 3, required: true, autocomplete: true },
                { name: 'mcid', description: 'Minecraft IDを入力', type: 3, required: true }
            ]
        }
    ];

    try {
        await client.application.commands.set(commands);
        console.log('スラッシュコマンドを更新しました。');
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }
});

// --- メッセージ受信処理 (管理者による証拠アップロード) ---
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // ログチャンネル内での返信かつ、管理者のメッセージ、かつファイル添付がある場合
    if (message.reference && message.attachments.size > 0 && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const settings = giveawaySettings.get(message.guild.id);
        if (!settings || message.channel.id !== settings.logChannelId) return;

        try {
            const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);
            // ログメッセージの埋め込みから当選者IDを抽出 (簡易的な実装)
            const userIdMatch = referencedMsg.content.match(/申請者: <@!?(\24d+)>|当選者ID: (\24d+)/);
            const winnerId = userIdMatch ? (userIdMatch[1] || userIdMatch[2]) : null;

            if (winnerId) {
                const winner = await client.users.fetch(winnerId);
                const file = message.attachments.first().url;

                // 当選者にDM送信
                await winner.send({
                    content: `🎁 **景品の受け渡し準備が完了しました！**\n以下の証拠画像を確認してください。`,
                    files: [file]
                });

                // proofチャンネルに転送
                const proofChannel = message.guild.channels.cache.get(settings.proofChannelId);
                if (proofChannel) {
                    await proofChannel.send({
                        content: `✅ 証拠アップロード: <@${winnerId}> 宛`,
                        files: [file]
                    });
                }

                await message.reply('✅ 当選者にDMで証拠を送信し、proofチャンネルに記録しました。');
            }
        } catch (e) {
            console.error(e);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options, guild, user } = interaction;

        if (commandName === 'gs') {
            const title = options.getString('title');
            const duration = ms(options.getString('time') || "");
            const num = options.getInteger('number');
            const logCh = options.getChannel('log');
            const proofCh = options.getChannel('proof');

            if (!duration) return interaction.reply({ content: '期間形式が不正です。', flags: MessageFlags.Ephemeral });

            // ギブアウェイ設定を保存
            giveawaySettings.set(guild.id, { logChannelId: logCh.id, proofChannelId: proofCh.id });

            await interaction.deferReply();
            const endTime = Math.floor((Date.now() + duration) / 1000);

            const createEmbed = (currentNum, finished = false, winnerList = []) => {
                let desc = finished ? `**ギブアウェイ終了**\n` : `${options.getString('description')}\n\n`;
                desc += `当選者数: **${num}**名\n終了: <t:${endTime}:${finished ? 'f' : 'R'}>\n`;
                if (finished) desc += `\n**当選者:**\n${winnerList.join('\n') || 'なし'}`;
                return new EmbedBuilder().setTitle(finished ? `【終了】${title}` : `🎉 GIVEAWAY: ${title}`).setColor(0xFFD700);
            };

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gs_join').setLabel('参加').setStyle(ButtonStyle.Success));
            const msg = await interaction.editReply({ embeds: [createEmbed(0)], components: [row] });

            const participants = new Set();
            const collector = msg.createMessageComponentCollector({ time: duration });

            collector.on('collect', async i => {
                if (participants.has(i.user.id)) participants.delete(i.user.id);
                else participants.add(i.user.id);
                await i.update({ embeds: [createEmbed(participants.size)] });
            });

            collector.on('end', async () => {
                const winners = Array.from(participants).sort(() => 0.5 - Math.random()).slice(0, num);
                const winnerMentions = winners.map(id => `<@${id}>`);
                await msg.edit({ embeds: [createEmbed(participants.size, true, winnerMentions)], components: [] });

                if (winners.length > 0) {
                    winners.forEach(wId => {
                        if (!giveawayWinners.has(wId)) giveawayWinners.set(wId, []);
                        giveawayWinners.get(wId).push({ title });
                    });
                }
            });
        }

        if (commandName === 'claim') {
            const item = options.getString('content');
            const mcid = options.getString('mcid');
            const settings = giveawaySettings.get(guild.id);

            if (!settings) return interaction.reply({ content: 'ギブアウェイ設定が見つかりません。', flags: MessageFlags.Ephemeral });

            let userData = giveawayWinners.get(user.id) || [];
            const idx = userData.findIndex(i => i.title === item);
            if (idx === -1) return interaction.reply({ content: '有効な当選権利がありません。', flags: MessageFlags.Ephemeral });

            const logChannel = guild.channels.cache.get(settings.logChannelId);
            if (logChannel) {
                await logChannel.send({
                    content: `📩 **新着の景品受取申請**\n申請者: <@${user.id}>\nMCID: \`${mcid}\`\n景品: **${item}**\n\n**管理者はこのメッセージに証拠ファイルを添付して返信してください。**`
                });
                
                // 申請済みとしてデータを削除
                userData.splice(idx, 1);
                if (userData.length === 0) giveawayWinners.delete(user.id);
                else giveawayWinners.set(user.id, userData);

                await interaction.reply({ content: '申請を送信しました。管理者の確認をお待ちください。', flags: MessageFlags.Ephemeral });
            }
        }
    }

    if (interaction.isAutocomplete()) {
        const userData = giveawayWinners.get(interaction.user.id) || [];
        await interaction.respond(userData.slice(0, 25).map(i => ({ name: i.title, value: i.title })));
    }
});

client.login(process.env.DISCORD_TOKEN);
