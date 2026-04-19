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

// --- HTTPサーバー (Keep Alive) ---
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running');
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
    partials: [Partials.Channel, Partials.Message] 
});

// データの保存用 (実際にはデータベース推奨)
const giveawaySettings = new Map(); // [guildId]: { logId, proofId }
const giveawayWinners = new Map();  // [userId]: [{ title }]

client.once('ready', async () => {
    console.log(`${client.user.tag} 起動完了`);
    
    const commands = [
        {
            name: 'gs',
            description: 'ギブアウェイを開始',
            default_member_permissions: PermissionFlagsBits.Administrator.toString(),
            options: [
                { name: 'title', description: '景品名', type: 3, required: true },
                { name: 'description', description: '詳細説明', type: 3, required: true },
                { name: 'time', description: '期間 (例: 10s, 1m, 1h)', type: 3, required: true },
                { name: 'number', description: '当選人数', type: 4, required: true },
                { name: 'log', description: 'ログ送信先チャンネル', type: 7, channel_types: [ChannelType.GuildText], required: true },
                { name: 'proof', description: '証拠用チャンネル', type: 7, channel_types: [ChannelType.GuildText], required: true },
                { name: 'sponsor', description: 'スポンサー名', type: 3, required: false },
            ]
        },
        {
            name: 'claim',
            description: '景品を申請',
            options: [
                { name: 'content', description: '受け取る景品を選択', type: 3, required: true, autocomplete: true },
                { name: 'mcid', description: 'Minecraft ID', type: 3, required: true }
            ]
        }
    ];

    try {
        await client.application.commands.set(commands);
        console.log('コマンド登録成功');
    } catch (err) {
        console.error('コマンド登録エラー:', err);
    }
});

// --- 管理者による証拠アップロード処理 ---
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // 1. 管理者が返信しているか確認
    // 2. ファイルが添付されているか確認
    if (message.reference && message.attachments.size > 0 && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const settings = giveawaySettings.get(message.guild.id);
        if (!settings || message.channel.id !== settings.logId) return;

        try {
            const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);
            
            // ログメッセージからユーザーIDを抽出する正規表現
            const idMatch = referencedMsg.content.match(/申請者: <@!?(\d+)>/);
            if (!idMatch) return;

            const winnerId = idMatch[1];
            const winner = await client.users.fetch(winnerId).catch(() => null);
            if (!winner) return message.reply('ユーザーが見つかりませんでした。');

            const attachment = message.attachments.first();

            // 当選者にDMを送信
            try {
                await winner.send({
                    content: `🎁 **景品の受け渡し準備が整いました！**\n申請いただいた景品の証拠をお送りします。`,
                    files: [{ attachment: attachment.url, name: attachment.name }]
                });
            } catch (dmErr) {
                return message.reply(`❌ <@${winnerId}> にDMを送信できませんでした（DMがオフの可能性があります）。`);
            }

            // proofチャンネルに送信
            const proofChannel = message.guild.channels.cache.get(settings.proofId);
            if (proofChannel) {
                await proofChannel.send({
                    content: `✅ 証拠送付完了: <@${winnerId}> 宛`,
                    files: [{ attachment: attachment.url, name: attachment.name }]
                });
            }

            await message.reply('✅ 当選者へのDM送信とproofチャンネルへの転送が完了しました。');

        } catch (err) {
            console.error('証拠送信エラー:', err);
            await message.reply('エラーが発生しました。詳細はコンソールを確認してください。');
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options, guild, user } = interaction;

        if (commandName === 'gs') {
            const title = options.getString('title');
            const desc = options.getString('description');
            const durationStr = options.getString('time');
            const count = options.getInteger('number');
            const logCh = options.getChannel('log');
            const proofCh = options.getChannel('proof');
            const sponsor = options.getString('sponsor');

            const timeMs = ms(durationStr || '');
            if (!timeMs) return interaction.reply({ content: '時間の指定が正しくありません (例: 1m, 1h)', flags: MessageFlags.Ephemeral });

            // 設定を保存
            giveawaySettings.set(guild.id, { logId: logCh.id, proofId: proofCh.id });

            await interaction.deferReply();
            const endTimestamp = Math.floor((Date.now() + timeMs) / 1000);

            // 埋め込み作成関数
            const buildEmbed = (participantsCount, isFinished = false, winners = []) => {
                const embed = new EmbedBuilder()
                    .setTitle(isFinished ? `【終了】${title}` : `🎉 ギブアウェイ: ${title}`)
                    .setColor(isFinished ? 0x808080 : 0x00FF00)
                    .setTimestamp();

                let descriptionText = `${desc}\n\n`;
                descriptionText += `当選者数: **${count}**\n`;
                descriptionText += `終了時間: <t:${endTimestamp}:${isFinished ? 'f' : 'R'}>\n`;
                descriptionText += `参加人数: **${participantsCount}**\n`;
                if (sponsor) descriptionText += `スポンサー: **${sponsor}**\n`;

                if (isFinished) {
                    descriptionText += `\n**当選者:**\n${winners.length > 0 ? winners.map(id => `<@${id}>`).join(', ') : 'なし'}`;
                }

                return embed.setDescription(descriptionText);
            };

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('join_gw').setLabel('参加 / 取消').setStyle(ButtonStyle.Primary).setEmoji('🎁')
            );

            const msg = await interaction.editReply({ embeds: [buildEmbed(0)], components: [row] });

            const participants = new Set();
            const collector = msg.createMessageComponentCollector({ time: timeMs });

            collector.on('collect', async i => {
                if (participants.has(i.user.id)) participants.delete(i.user.id);
                else participants.add(i.user.id);
                await i.update({ embeds: [buildEmbed(participants.size)] }).catch(() => {});
            });

            collector.on('end', async () => {
                const winnerList = Array.from(participants).sort(() => 0.5 - Math.random()).slice(0, count);
                
                await msg.edit({ embeds: [buildEmbed(participants.size, true, winnerList)], components: [] }).catch(() => {});

                if (winnerList.length > 0) {
                    interaction.channel.send(`🎊 **${title}** の当選者が決定しました！\n当選者: ${winnerList.map(id => `<@${id}>`).join(' ')}\n\`/claim\` で申請してください。`);
                    
                    winnerList.forEach(id => {
                        const existing = giveawayWinners.get(id) || [];
                        existing.push({ title });
                        giveawayWinners.set(id, existing);
                    });
                }
            });
        }

        if (commandName === 'claim') {
            const content = options.getString('content');
            const mcid = options.getString('mcid');
            const settings = giveawaySettings.get(guild.id);

            if (!settings) return interaction.reply({ content: 'ギブアウェイ設定が見つかりません。', flags: MessageFlags.Ephemeral });

            const userPrizes = giveawayWinners.get(user.id) || [];
            const prizeIndex = userPrizes.findIndex(p => p.title === content);

            if (prizeIndex === -1) {
                return interaction.reply({ content: 'その景品の当選履歴がありません。', flags: MessageFlags.Ephemeral });
            }

            const logChannel = guild.channels.cache.get(settings.logId);
            if (!logChannel) return interaction.reply({ content: 'ログチャンネルが設定されていないか見つかりません。', flags: MessageFlags.Ephemeral });

            // ログチャンネルに送信
            await logChannel.send({
                content: `📩 **新しい景品申請**\n申請者: <@${user.id}>\nMCID: \`${mcid}\`\n景品: **${content}**\n\n**[管理者へ]** このメッセージに証拠ファイルを添付して「返信」してください。`
            });

            // 権利を削除
            userPrizes.splice(prizeIndex, 1);
            if (userPrizes.length === 0) giveawayWinners.delete(user.id);
            else giveawayWinners.set(user.id, userPrizes);

            await interaction.reply({ content: `申請をログチャンネルに送信しました。管理者の対応をお待ちください。`, flags: MessageFlags.Ephemeral });
        }
    }

    if (interaction.isAutocomplete()) {
        const userPrizes = giveawayWinners.get(interaction.user.id) || [];
        const choices = userPrizes.map(p => ({ name: p.title, value: p.title }));
        await interaction.respond(choices.slice(0, 25));
    }
});

client.login(process.env.DISCORD_TOKEN);
