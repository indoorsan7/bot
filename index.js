const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits, 
    ChannelType,
    Partials 
} = require('discord.js');
const http = require('http');
const ms = require('ms');

// --- HTTPサーバー (24時間稼働用) ---
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
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages 
    ],
    partials: [Partials.Channel] 
});

// データ保存用 (永続化が必要な場合はDBを推奨)
const giveawayWinners = new Map();
const verifyingUsers = new Map();

// --- 便利関数 ---

// カテゴリ取得・作成の競合を防ぐためのロック変数
let isCreatingCategory = false;

async function getCategory(guild, name) {
    let category = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
    
    if (!category) {
        if (isCreatingCategory) {
            // 他の処理が作成中なら1秒待って再試行
            await new Promise(resolve => setTimeout(resolve, 1000));
            return getCategory(guild, name);
        }
        isCreatingCategory = true;
        try {
            category = await guild.channels.create({ name, type: ChannelType.GuildCategory });
        } finally {
            isCreatingCategory = false;
        }
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
        },
        {
            name: 'verify',
            description: '認証パネルを作成します',
            default_member_permissions: PermissionFlagsBits.Administrator.toString(),
            options: [
                { name: 'role', description: '認証後に付与するロール', type: 8, required: true }
            ]
        }
    ];
    await client.application.commands.set(commands);
});

// --- DM認証回答の処理 ---
client.on('messageCreate', async message => {
    if (message.author.bot || message.guild) return; 

    const data = verifyingUsers.get(message.author.id);
    if (!data) return;

    if (parseInt(message.content) === data.answer) {
        try {
            const guild = await client.guilds.fetch(data.guildId);
            const member = await guild.members.fetch(message.author.id);
            await member.roles.add(data.roleId);
            
            await message.reply('✅ 正解です！認証が完了し、ロールが付与されました。');
            verifyingUsers.delete(message.author.id);
        } catch (e) {
            console.error(e);
            await message.reply('❌ エラーが発生しました。サーバーにいないか、BOTの権限が不足しています。');
        }
    } else {
        await message.reply('❌ 答えが違います。もう一度数値を入力してください。');
    }
});

// --- インタラクション処理 ---
client.on('interactionCreate', async interaction => {
    
    if (interaction.isChatInputCommand()) {
        const { commandName, options, guild, user } = interaction;

        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder()
                .setTitle('✅ 認証システム')
                .setDescription('下のボタンを押して認証を開始してください。\nDMで簡単な計算問題が出題されます。')
                .setColor(0x00FF00);
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`verify_start_${role.id}`).setLabel('認証する').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticket') {
            const embed = new EmbedBuilder()
                .setTitle(options.getString('title'))
                .setDescription(options.getString('description'))
                .setColor(0x00AAFF);

            const row = new ActionRowBuilder();
            let hasButtons = false;
            for (let i = 1; i <= 4; i++) {
                const label = options.getString(`button${i}`);
                if (label) {
                    row.addComponents(new ButtonBuilder().setCustomId(`t_open_${label}`).setLabel(label).setStyle(ButtonStyle.Primary));
                    hasButtons = true;
                }
            }
            if (!hasButtons) return interaction.reply({ content: 'ボタンを少なくとも1つ設定してください。', ephemeral: true });
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'gs') {
            const title = options.getString('title');
            const duration = ms(options.getString('time') || "");
            const num = options.getInteger('number');
            const sponsor = options.getString('sponsor');
            const delInput = options.getString('delete_time');

            if (!duration) return interaction.reply({ content: '期間形式が不正です。', ephemeral: true });

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
                if (finished) desc += `\n**当選者:**\n${winnerList.length > 0 ? winnerList.join('\n') : 'なし'}`;

                return new EmbedBuilder()
                    .setTitle(finished ? `【終了】${title}` : `🎉 GIVEAWAY: ${title}`)
                    .setDescription(desc)
                    .setColor(finished ? 0x2C2F33 : 0xFFD700);
            };

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('gs_join').setLabel('参加 / 辞退').setStyle(ButtonStyle.Success).setEmoji('🎁')
            );

            const response = await interaction.editReply({ embeds: [createEmbed(0)], components: [row] });
            const msg = response;

            const participants = new Set();
            const collector = msg.createMessageComponentCollector({ time: duration });

            collector.on('collect', async i => {
                if (participants.has(i.user.id)) {
                    participants.delete(i.user.id);
                } else {
                    participants.add(i.user.id);
                }
                await i.update({ embeds: [createEmbed(participants.size)] }).catch(() => {});
            });

            collector.on('end', async () => {
                const winners = Array.from(participants).sort(() => 0.5 - Math.random()).slice(0, num);
                const winnerMentions = winners.map(id => `<@${id}>`);

                await msg.edit({ 
                    embeds: [createEmbed(participants.size, true, winnerMentions)], 
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('gs_end').setLabel('終了').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    )]
                }).catch(() => {});

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
            });
        }

        if (commandName === 'claim') {
            const item = options.getString('content');
            let userData = giveawayWinners.get(user.id) || [];
            const idx = userData.findIndex(i => i.title === item && (i.expire === null || i.expire > Date.now()));

            if (idx === -1) return interaction.reply({ content: '有効な当選データが見つかりません。', ephemeral: true });

            // 重複チェック
            const existing = guild.channels.cache.find(c => c.name === `claim-${user.username.toLowerCase()}`);
            if (existing) return interaction.reply({ content: `既にチャンネルが開かれています: ${existing}`, ephemeral: true });

            await interaction.deferReply({ ephemeral: true });

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
            await interaction.editReply({ content: `作成しました: ${claimCh}` });
            claimCh.send({ content: `<@${user.id}> さんの景品: **${item}**`, components: [row] });
        }
    }

    if (interaction.isAutocomplete()) {
        const userData = giveawayWinners.get(interaction.user.id) || [];
        const active = userData.filter(i => i.expire === null || i.expire > Date.now());
        await interaction.respond(active.slice(0, 25).map(i => ({ name: i.title, value: i.title })));
    }

    if (interaction.isButton()) {
        const { customId, guild, channel, user, member } = interaction;

        // 【認証開始】
        if (customId.startsWith('verify_start_')) {
            const roleId = customId.replace('verify_start_', '');
            const n1 = Math.floor(Math.random() * 9) + 1;
            const n2 = Math.floor(Math.random() * 9) + 1;
            const answer = n1 + n2;

            try {
                await user.send(`**${guild.name}** の認証です。\n以下の計算の答えを数字で送信してください：\n\n**${n1} + ${n2} = ?**`);
                verifyingUsers.set(user.id, { answer, roleId, guildId: guild.id });
                await interaction.reply({ content: 'DMを送りました。確認してください。', ephemeral: true });
            } catch (e) {
                await interaction.reply({ content: 'DMを送信できませんでした。設定を確認してください。', ephemeral: true });
            }
        }

        // 【チケット作成】
        if (customId.startsWith('t_open_')) {
            const label = customId.replace('t_open_', '');
            
            // 1人1つまでの制限チェック
            const existing = guild.channels.cache.find(c => 
                (c.name.startsWith('ticket-') || c.name.startsWith('claim-')) && 
                c.name.toLowerCase().includes(user.username.toLowerCase())
            );

            if (existing) {
                return interaction.reply({ content: `既にチャンネルが開かれています: ${existing}\n先にそちらを終了してください。`, ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            try {
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
                await interaction.editReply({ content: `作成しました: ${ticketCh}` });
                ticketCh.send({ content: `<@${user.id}> さん、要件をどうぞ。`, components: [row] });
            } catch (err) {
                console.error(err);
                await interaction.editReply({ content: 'チャンネル作成中にエラーが発生しました。' });
            }
        }

        if (customId === 'close_ch') {
            await interaction.deferUpdate();
            // 作成者本人からチャンネルを隠す
            await channel.permissionOverwrites.set([{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }]);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_ch').setLabel('削除').setStyle(ButtonStyle.Danger));
            await channel.send({ content: 'クローズされました。管理者は以下のボタンで削除できます。', components: [row] });
        }

        if (customId === 'delete_ch') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: 'この操作は管理者のみ可能です。', ephemeral: true });
            }
            const pId = channel.parentId;
            await channel.delete().catch(() => {});
            if (pId) await checkAndDeleteCategory(guild, pId);
        }
    }
});

client.login(process.env.DISCORD_TOKEN).catch(err => console.error(err));
