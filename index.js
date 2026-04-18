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
        GatewayIntentBits.DirectMessages // DMを受け取るために必須
    ],
    partials: [
        Partials.Channel, 
        Partials.Message // DMを正常に検知するために必須
    ] 
});

const giveawayWinners = new Map();
const verifyingUsers = new Map();

// --- 便利関数 ---
let isCreatingCategory = false;

async function getCategory(guild, name) {
    let category = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
    if (!category) {
        if (isCreatingCategory) {
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
            name: 'verify',
            description: '認証パネルを作成します',
            default_member_permissions: PermissionFlagsBits.Administrator.toString(),
            options: [
                { name: 'role', description: '認証後に付与するロール', type: 8, required: true }
            ]
        },
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

    try {
        const registeredCommands = await client.application.commands.set(commands);
        console.log('--- スラッシュコマンドの登録完了 ---');
        registeredCommands.forEach(cmd => {
            console.log(`[登録済み] /${cmd.name}: ${cmd.description}`);
        });
        console.log('-----------------------------------');
    } catch (error) {
        console.error('コマンド登録中にエラーが発生しました:', error);
    }
});

// --- DMでの認証回答処理 ---
client.on('messageCreate', async (message) => {
    // BOT自身やサーバー内のメッセージは無視
    if (message.author.bot || message.guild) return;

    const data = verifyingUsers.get(message.author.id);
    if (!data) return;

    // 半角・全角数字の両方に対応
    const userAnswer = parseInt(message.content.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)));

    if (userAnswer === data.answer) {
        try {
            const guild = await client.guilds.fetch(data.guildId);
            const member = await guild.members.fetch(message.author.id);
            const role = await guild.roles.fetch(data.roleId);

            if (role) {
                await member.roles.add(role);
                await message.reply(`✅ 正解です！ **${guild.name}** での認証が完了しました。`);
                verifyingUsers.delete(message.author.id);
            } else {
                await message.reply('❌ 付与するロールが見つかりませんでした。');
            }
        } catch (error) {
            console.error(error);
            await message.reply('❌ エラーが発生しました。BOTの権限やロール順序を確認してください。');
        }
    } else {
        await message.reply('❌ 答えが違います。数値を入力し直してください。');
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
                .setDescription('下のボタンを押すとDMで計算問題が出題されます。\n正解するとロールが付与されます。')
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
            let count = 0;
            for (let i = 1; i <= 4; i++) {
                const label = options.getString(`button${i}`);
                if (label) {
                    row.addComponents(new ButtonBuilder().setCustomId(`t_open_${label}`).setLabel(label).setStyle(ButtonStyle.Primary));
                    count++;
                }
            }
            if (count === 0) return interaction.reply({ content: 'ボタンを設定してください。', flags: MessageFlags.Ephemeral });
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'gs') {
            const title = options.getString('title');
            const duration = ms(options.getString('time') || "");
            const num = options.getInteger('number');
            const sponsor = options.getString('sponsor');
            const delInput = options.getString('delete_time');

            if (!duration) return interaction.reply({ content: '期間形式が不正です。', flags: MessageFlags.Ephemeral });
            await interaction.deferReply();

            const endTime = Math.floor((Date.now() + duration) / 1000);
            const createEmbed = (currentNum, finished = false, winnerList = []) => {
                let desc = finished ? `**このギブアウェイは終了しました。**\n\n` : `${options.getString('description')}\n\n`;
                desc += `当選者数: **${num}**名\n終了: <t:${endTime}:${finished ? 'f' : 'R'}>\nエントリー: **${currentNum}**人\n`;
                if (sponsor) desc += `スポンサー: ${sponsor.startsWith('<@') ? sponsor : `<@${sponsor}>`}\n`;
                if (finished) desc += `\n**当選者:**\n${winnerList.length > 0 ? winnerList.join('\n') : 'なし'}`;
                return new EmbedBuilder().setTitle(finished ? `【終了】${title}` : `🎉 GIVEAWAY: ${title}`).setDescription(desc).setColor(finished ? 0x2C2F33 : 0xFFD700);
            };

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gs_join').setLabel('参加 / 辞退').setStyle(ButtonStyle.Success).setEmoji('🎁'));
            const msg = await interaction.editReply({ embeds: [createEmbed(0)], components: [row] });

            const participants = new Set();
            const collector = msg.createMessageComponentCollector({ time: duration });
            collector.on('collect', async i => {
                if (participants.has(i.user.id)) participants.delete(i.user.id);
                else participants.add(i.user.id);
                await i.update({ embeds: [createEmbed(participants.size)] }).catch(() => {});
            });
            collector.on('end', async () => {
                const winners = Array.from(participants).sort(() => 0.5 - Math.random()).slice(0, num);
                const winnerMentions = winners.map(id => `<@${id}>`);
                await msg.edit({ embeds: [createEmbed(participants.size, true, winnerMentions)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gs_end').setLabel('終了').setStyle(ButtonStyle.Secondary).setDisabled(true))] }).catch(() => {});
                if (winners.length > 0) {
                    interaction.channel.send(`🎊 **${title}** 当選者: ${winnerMentions.join(' ')}\n\`/claim\` で受け取ってください。`);
                    winners.forEach(wId => {
                        if (!giveawayWinners.has(wId)) giveawayWinners.set(wId, []);
                        giveawayWinners.get(wId).push({ title, expire: delInput ? Date.now() + ms(delInput) : null });
                    });
                }
            });
        }

        if (commandName === 'claim') {
            const item = options.getString('content');
            let userData = giveawayWinners.get(user.id) || [];
            const idx = userData.findIndex(i => i.title === item && (i.expire === null || i.expire > Date.now()));
            if (idx === -1) return interaction.reply({ content: '有効な当選データがありません。', flags: MessageFlags.Ephemeral });

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
            await interaction.reply({ content: '受取チャンネルを作成しました。', flags: MessageFlags.Ephemeral });
            await claimCh.send({ content: `<@${user.id}> さんの景品: **${item}**`, components: [row] });
        }
    }

    if (interaction.isAutocomplete()) {
        const userData = giveawayWinners.get(interaction.user.id) || [];
        const active = userData.filter(i => i.expire === null || i.expire > Date.now());
        await interaction.respond(active.slice(0, 25).map(i => ({ name: i.title, value: i.title })));
    }

    if (interaction.isButton()) {
        const { customId, guild, channel, user, member } = interaction;

        if (customId.startsWith('verify_start_')) {
            const roleId = customId.replace('verify_start_', '');
            const n1 = Math.floor(Math.random() * 9) + 1;
            const n2 = Math.floor(Math.random() * 9) + 1;
            const answer = n1 + n2;
            try {
                await user.send(`**${guild.name}** 認証: **${n1} + ${n2} = ?** を数字で返信してください。`);
                verifyingUsers.set(user.id, { answer, roleId, guildId: guild.id });
                await interaction.reply({ content: 'DMに問題を送信しました。', flags: MessageFlags.Ephemeral });
            } catch (e) {
                await interaction.reply({ content: 'DMを送信できませんでした（DMが閉じていませんか？）。', flags: MessageFlags.Ephemeral });
            }
        }

        if (customId.startsWith('t_open_')) {
            const category = await getCategory(guild, '---ticket---');
            const ticketCh = await guild.channels.create({
                name: `ticket-${customId.replace('t_open_', '')}-${user.username}`,
                parent: category.id,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                ],
            });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ch').setLabel('クローズ').setStyle(ButtonStyle.Danger));
            await interaction.reply({ content: '作成完了', flags: MessageFlags.Ephemeral });
            await ticketCh.send({ content: `<@${user.id}> さん、要件をどうぞ。`, components: [row] });
        }

        if (customId === 'close_ch') {
            await channel.permissionOverwrites.set([{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }]);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_ch').setLabel('削除').setStyle(ButtonStyle.Danger));
            await channel.send({ content: 'クローズされました。管理者は削除できます。', components: [row] });
        }

        if (customId === 'delete_ch') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '権限不足', flags: MessageFlags.Ephemeral });
            const pId = channel.parentId;
            await channel.delete().catch(() => {});
            if (pId) await checkAndDeleteCategory(guild, pId);
        }
    }
});

client.login(process.env.DISCORD_TOKEN).catch(err => console.error(err));
