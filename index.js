const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits, 
    ChannelType 
} = require('discord.js');
const http = require('http');
const ms = require('ms');

// --- HTTPサーバー (Render等の常時起動用) ---
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
        GatewayIntentBits.GuildMembers, // これを追加
        GatewayIntentBits.GuildPresences // これを追加
    ]
});

// 当選データ保存用
const giveawayWinners = new Map();

// --- 便利関数 ---
async function getCategory(guild, name) {
    let category = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
    if (!category) {
        category = await guild.channels.create({ name, type: ChannelType.GuildCategory });
    }
    return category;
}

async function checkAndDeleteCategory(guild, categoryId) {
    const category = guild.channels.cache.get(categoryId);
    if (category && category.children.cache.size === 0) {
        await category.delete().catch(() => {});
    }
}

// --- 起動イベント ---
client.once('ready', async () => {
    console.log(`${client.user.tag} が正常に起動しました！`);
    const commands = [
        {
            name: 'ticket',
            description: 'チケットパネルを作成します',
            default_member_permissions: PermissionFlagsBits.Administrator.toString(),
            options: [
                { name: 'title', description: 'タイトル', type: 3, required: true },
                { name: 'description', description: '説明文', type: 3, required: true },
                { name: 'button1', description: 'ボタン1', type: 3, required: true },
                { name: 'button2', description: 'ボタン2', type: 3, required: false },
                { name: 'button3', description: 'ボタン3', type: 3, required: false },
                { name: 'button4', description: 'ボタン4', type: 3, required: false },
            ]
        },
        {
            name: 'gs',
            description: 'ギブアウェイを開始します',
            default_member_permissions: PermissionFlagsBits.Administrator.toString(),
            options: [
                { name: 'title', description: '景品名', type: 3, required: true },
                { name: 'description', description: '詳細', type: 3, required: true },
                { name: 'time', description: '期間 (10s, 1m, 1h)', type: 3, required: true },
                { name: 'number', description: '当選人数', type: 4, required: true },
                { name: 'sponsor', description: 'スポンサー (IDまたはメンション)', type: 3, required: false },
                { name: 'delete_time', description: '受取期限 (例: 1d, 1h)', type: 3, required: false },
            ]
        },
        {
            name: 'claim',
            description: '当選した景品を受け取ります',
            options: [
                { name: 'content', description: '受取対象を選択', type: 3, required: true, autocomplete: true }
            ]
        }
    ];
    await client.application.commands.set(commands);
});

// --- インタラクション処理 ---
client.on('interactionCreate', async interaction => {
    
    // スラッシュコマンド
    if (interaction.isChatInputCommand()) {
        const { commandName, options, guild, user } = interaction;

        // 【Ticket】
        if (commandName === 'ticket') {
            const embed = new EmbedBuilder()
                .setTitle(options.getString('title'))
                .setDescription(options.getString('description'))
                .setColor(0x00AAFF);

            const row = new ActionRowBuilder();
            for (let i = 1; i <= 4; i++) {
                const label = options.getString(`button${i}`);
                if (label) row.addComponents(new ButtonBuilder().setCustomId(`t_open_${label}`).setLabel(label).setStyle(ButtonStyle.Primary));
            }
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // 【Giveaway】
        if (commandName === 'gs') {
            const title = options.getString('title');
            const duration = ms(options.getString('time') || "");
            const num = options.getInteger('number');
            const sponsor = options.getString('sponsor');
            const delInput = options.getString('delete_time');

            if (!duration) return interaction.reply({ content: '期間形式が不正です。', ephemeral: true });

            // 応答を保留 (Unknown Interaction対策)
            await interaction.deferReply();

            const endTime = Math.floor((Date.now() + duration) / 1000);
            const sponsorMention = sponsor ? (sponsor.startsWith('<@') ? sponsor : `<@${sponsor}>`) : null;

            const createEmbed = (currentNum, finished = false, winnerList = []) => {
                let desc = finished ? `**このギブアウェイは終了しました。**\n\n` : `${options.getString('description')}\n\n`;
                desc += `当選者数: **${num}**名\n`;
                desc += finished ? `終了日時: <t:${endTime}:f>\n` : `終了: <t:${endTime}:R>\n`;
                desc += `エントリー人数: **${currentNum}**人\n`;
                if (sponsorMention) desc += `スポンサー: ${sponsorMention}\n`;
                if (delInput) desc += `受取期限: **${delInput}以内**\n`;
                
                if (finished) {
                    desc += `\n**当選者:**\n${winnerList.length > 0 ? winnerList.join('\n') : 'なし'}`;
                }

                return new EmbedBuilder()
                    .setTitle(finished ? `【終了】${title}` : `🎉 GIVEAWAY: ${title}`)
                    .setDescription(desc)
                    .setColor(finished ? 0x2C2F33 : 0xFFD700);
            };

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('gs_join').setLabel('参加 / 辞退').setStyle(ButtonStyle.Success).setEmoji('🎁')
            );

            // メッセージ送信とオブジェクト取得
            const response = await interaction.editReply({ 
                embeds: [createEmbed(0)], 
                components: [row],
                withResponse: true 
            });
            const msg = response.resource ? response.resource.message : response;

            const participants = new Set();
            const collector = msg.createMessageComponentCollector({ time: duration });

            collector.on('collect', async i => {
                try {
                    if (participants.has(i.user.id)) {
                        participants.delete(i.user.id);
                        await i.update({ embeds: [createEmbed(participants.size)] });
                    } else {
                        participants.add(i.user.id);
                        await i.update({ embeds: [createEmbed(participants.size)] });
                    }
                } catch (e) { console.error(e); }
            });

            collector.on('end', async () => {
                try {
                    const winners = Array.from(participants).sort(() => 0.5 - Math.random()).slice(0, num);
                    const winnerMentions = winners.map(id => `<@${id}>`);

                    await msg.edit({ 
                        embeds: [createEmbed(participants.size, true, winnerMentions)], 
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('gs_end').setLabel('終了').setStyle(ButtonStyle.Secondary).setDisabled(true)
                        )]
                    });

                    if (winners.length > 0) {
                        const delMs = delInput ? ms(delInput) : null;
                        const limitTs = delMs ? Math.floor((Date.now() + delMs) / 1000) : null;

                        let announce = `🎊 **${title}** の当選者が決定しました！\n当選者: ${winnerMentions.join(' ')}\n\`/claim\` で受け取ってください。`;
                        if (limitTs) announce += ` (期限: <t:${limitTs}:t>)`;
                        
                        interaction.channel.send(announce);

                        winners.forEach(wId => {
                            if (!giveawayWinners.has(wId)) giveawayWinners.set(wId, []);
                            giveawayWinners.get(wId).push({ title, expire: delMs ? Date.now() + delMs : null });
                        });
                    } else {
                        interaction.channel.send(`**${title}**: 参加者がいなかったため、当選者はいませんでした。`);
                    }
                } catch (e) { console.error(e); }
            });
        }

        // 【Claim】
        if (commandName === 'claim') {
            const item = options.getString('content');
            let userData = giveawayWinners.get(user.id) || [];
            const idx = userData.findIndex(i => i.title === item && (i.expire === null || i.expire > Date.now()));

            if (idx === -1) return interaction.reply({ content: '有効な当選データが見つかりません。', ephemeral: true });

            const category = await getCategory(guild, '---claim---');
            const claimCh = await guild.channels.create({
                name: `claim-${user.username}`,
                parent: category.id,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                ],
            });

            userData.splice(idx, 1);
            if (userData.length === 0) giveawayWinners.delete(user.id);
            else giveawayWinners.set(user.id, userData);

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ch').setLabel('クローズ').setStyle(ButtonStyle.Danger));
            await interaction.reply({ content: '作成しました。リストから削除しました。', ephemeral: true });
            claimCh.send({ content: `<@${user.id}> さんの景品: **${item}**`, components: [row] });
        }
    }

    // オートコンプリート
    if (interaction.isAutocomplete()) {
        const userData = giveawayWinners.get(interaction.user.id) || [];
        const active = userData.filter(i => i.expire === null || i.expire > Date.now());
        await interaction.respond(active.slice(0, 25).map(i => ({ name: i.title, value: i.title })));
    }

    // ボタン
    if (interaction.isButton()) {
        const { customId, guild, channel, user, member } = interaction;

        if (customId.startsWith('t_open_')) {
            const label = customId.replace('t_open_', '');
            const category = await getCategory(guild, '---ticket---');
            const ticketCh = await guild.channels.create({
                name: `ticket-${label}-${user.username}`,
                parent: category.id,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                ],
            });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ch').setLabel('クローズ').setStyle(ButtonStyle.Danger));
            await interaction.reply({ content: '作成完了', ephemeral: true });
            ticketCh.send({ content: `<@${user.id}> さん、要件をどうぞ。`, components: [row] });
        }

        if (customId === 'close_ch') {
            await interaction.reply('クローズしました。作成者本人の閲覧権限を削除しました。');
            await channel.permissionOverwrites.set([{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }]);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_ch').setLabel('削除').setStyle(ButtonStyle.Danger));
            await channel.send({ content: '管理者は削除ボタンで削除できます。', components: [row] });
        }

        if (customId === 'delete_ch') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '権限不足', ephemeral: true });
            const pId = channel.parentId;
            await channel.delete();
            if (pId) await checkAndDeleteCategory(guild, pId);
        }
    }
});

// --- ログイン処理 (最終デバッグ版) ---
console.log("Discordへのログインを開始します...");

// 5秒経っても反応がない場合の警告を追加
const timeout = setTimeout(() => {
    console.log("警告: ログイン処理が5秒以上経過しても完了していません。通信が詰まっている可能性があります。");
}, 5000);

client.login(process.env.DISCORD_TOKEN).then(() => {
    clearTimeout(timeout);
    console.log("【成功】Discordに接続されました！");
}).catch(err => {
    clearTimeout(timeout);
    console.error("【失敗】ログインエラーが発生しました:");
    
    if (err.message.includes("Privileged intent")) {
        console.error("原因: インテント(Intents)がDeveloper Portalで有効になっていません。");
    } else if (err.message.includes("An invalid token")) {
        console.error("原因: トークンが間違っているか、無効化されています。");
    } else {
        console.error("エラー詳細:", err);
    }
});
