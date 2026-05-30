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
    MessageFlags,
    ActivityType
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

const giveawayWinners = new Map();
const verifyingUsers = new Map();
const giveawayBlacklist = new Set(); // ギブアウェイBANリスト

// --- ステータスローテーション ---
function startStatusRotation() {
    let toggle = false;
    setInterval(() => {
        const ping = client.ws.ping;
        const servers = client.guilds.cache.size;
        const users = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

        const statusText = toggle
            ? `/help || ping:${ping}ms`
            : `${servers}servers || ${users}users`;

        client.user.setPresence({
            activities: [{ name: statusText, type: ActivityType.Custom }],
            status: 'online',
        });

        toggle = !toggle;
    }, 3000);
}

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
client.once('clientReady', async () => {
    console.log(`${client.user.tag} が正常に起動しました！`);
    
    const commands = [
        {
            name: 'help',
            description: 'コマンド一覧を表示します',
        },
        {
            name: 'ping',
            description: 'BOTの応答速度を確認します',
        },
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
            options: [
                { name: 'title', description: '景品名', type: 3, required: true },
                { name: 'description', description: '詳細', type: 3, required: true },
                { name: 'time', description: '期間 (10s, 1m, 1h)', type: 3, required: true },
                { name: 'number', description: '当選人数', type: 4, required: true },
                { name: 'sponsor', description: 'スポンサー (IDまたはメンション)', type: 3, required: false },
                { name: 'delete_time', description: '受取期限 (例: 1d, 1h)', type: 3, required: false },
                { name: 'role', description: '景品受け取り対応ロール', type: 8, required: false },
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
            name: 'dice',
            description: 'ダイスを振ります (例: 1d6, 2d100)',
            options: [
                { name: 'notation', description: 'ダイス記法 (例: 1d6, 2d20, 3d100)', type: 3, required: true }
            ]
        },
        {
            name: 'blacklist',
            description: 'ギブアウェイのブラックリストを管理します',
            default_member_permissions: PermissionFlagsBits.Administrator.toString(),
            options: [
                {
                    name: 'add',
                    description: 'ユーザーをブラックリストに追加します',
                    type: 1,
                    options: [{ name: 'user', description: '対象ユーザー', type: 6, required: true }]
                },
                {
                    name: 'remove',
                    description: 'ユーザーをブラックリストから削除します',
                    type: 1,
                    options: [{ name: 'user', description: '対象ユーザー', type: 6, required: true }]
                },
                {
                    name: 'list',
                    description: 'ブラックリストを表示します',
                    type: 1,
                }
            ]
        }
    ];

    try {
        console.log('スラッシュコマンドを同期中...');
        const synced = await client.application.commands.set(commands);
        synced.forEach(cmd => console.log(`  ✅ /${cmd.name} を同期しました`));
        console.log(`🎉 計 ${synced.size} 件のコマンドの同期が完了しました！`);
    } catch (error) {
        console.error('❌ コマンド同期中にエラーが発生しました:', error);
    }

    startStatusRotation();
});

// --- DM認証処理 ---
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
            await message.reply('❌ サーバー内でエラーが発生しました。BOTの権限やロール順序を確認してください。');
        }
    } else {
        await message.reply('❌ 答えが違います。もう一度数値を入力してください。');
    }
});

// --- インタラクション処理 ---
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options, guild, user } = interaction;

        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📋 コマンド一覧')
                .setColor(0x5865F2)
                .addFields(
                    {
                        name: '📡 `/ping`',
                        value: 'BOTの応答速度（レイテンシ）を確認します。',
                    },
                    {
                        name: '🔐 `/verify`',
                        value: '認証パネルを作成します。\n`role`: 認証後に付与するロール',
                    },
                    {
                        name: '🎫 `/ticket`',
                        value: 'チケットパネルを作成します。\n`title`: タイトル　`description`: 説明文\n`button1~4`: ボタン名（最大4つ）',
                    },
                    {
                        name: '🎉 `/gs`',
                        value: 'ギブアウェイを開始します。\n`title`: 景品名　`description`: 詳細\n`time`: 期間（例: 10s, 1m, 1h）　`number`: 当選人数\n`sponsor`: スポンサー（任意）　`delete_time`: 受取期限（任意）\n`role`: 景品対応ロール（任意）— そのロール所持者が `/claim` で代わりに対応可能',
                    },
                    {
                        name: '🎁 `/claim`',
                        value: '当選した景品の受取チャンネルを作成します。\n`content`: 受け取る景品名（オートコンプリート対応）\n当選者本人または対応ロール所持者が実行できます。',
                    },
                    {
                        name: '🎲 `/dice`',
                        value: 'ダイスを振ります。\n`notation`: ダイス記法（例: `1d6`, `2d20`, `3d100`）\n複数ダイスの場合は個別の結果と合計を表示します。',
                    },
                    {
                        name: '🚫 `/blacklist`',
                        value: 'ギブアウェイのBANリストを管理します。（管理者専用）\n`add user:` ユーザーを追加\n`remove user:` ユーザーを削除\n`list` 一覧表示',
                    }
                )
                .setFooter({ text: `ping: ${client.ws.ping}ms` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'ping') {
            const sent = await interaction.reply({ content: '🏓 計測中...', fetchReply: true });
            const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
            await interaction.editReply(`🏓 Pong!\nレイテンシ: **${roundtrip}ms** | WebSocket: **${client.ws.ping}ms**`);
        }
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
            if (!hasButtons) return interaction.reply({ content: 'ボタンを設定してください。', flags: MessageFlags.Ephemeral });
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'gs') {
            const title = options.getString('title');
            const duration = ms(options.getString('time') || "");
            const num = options.getInteger('number');
            const sponsor = options.getString('sponsor');
            const delInput = options.getString('delete_time');
            const gsRole = options.getRole('role');

            if (!duration) return interaction.reply({ content: '期間形式が不正です。', flags: MessageFlags.Ephemeral });
            await interaction.deferReply();

            const endTime = Math.floor((Date.now() + duration) / 1000);
            const createEmbed = (currentNum, finished = false, winnerList = []) => {
                let desc = finished ? `**このギブアウェイは終了しました。**\n\n` : `${options.getString('description')}\n\n`;
                desc += `当選者数: **${num}**名\n終了: <t:${endTime}:${finished ? 'f' : 'R'}>\nエントリー: **${currentNum}**人\n`;
                if (sponsor) desc += `スポンサー: ${sponsor.startsWith('<@') ? sponsor : `<@${sponsor}>`}\n`;
                if (gsRole) desc += `対応ロール: ${gsRole}\n`;
                if (finished) desc += `\n**当選者:**\n${winnerList.length > 0 ? winnerList.join('\n') : 'なし'}`;
                return new EmbedBuilder().setTitle(finished ? `【終了】${title}` : `🎉 GIVEAWAY: ${title}`).setDescription(desc).setColor(finished ? 0x2C2F33 : 0xFFD700);
            };

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gs_join').setLabel('参加 / 辞退').setStyle(ButtonStyle.Success).setEmoji('🎁'));
            const msg = await interaction.editReply({ embeds: [createEmbed(0)], components: [row] });

            const participants = new Set();
            const collector = msg.createMessageComponentCollector({ time: duration });
            collector.on('collect', async i => {
                if (giveawayBlacklist.has(i.user.id)) {
                    return i.reply({ content: '🚫 あなたはギブアウェイへの参加が禁止されています。', flags: MessageFlags.Ephemeral }).catch(() => {});
                }
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
                        giveawayWinners.get(wId).push({ title, expire: delInput ? Date.now() + ms(delInput) : null, roleId: gsRole ? gsRole.id : null });
                    });
                }
            });
        }

        if (commandName === 'dice') {
            const notation = options.getString('notation').trim().toLowerCase();
            const match = notation.match(/^(\d+)d(\d+)$/);
            if (!match) return interaction.reply({ content: '❌ 形式が正しくありません。`1d6` や `2d100` のように入力してください。', flags: MessageFlags.Ephemeral });

            const count = parseInt(match[1]);
            const faces = parseInt(match[2]);

            if (count < 1 || count > 100) return interaction.reply({ content: '❌ ダイスの数は1〜100にしてください。', flags: MessageFlags.Ephemeral });
            if (faces < 2 || faces > 1000000) return interaction.reply({ content: '❌ 面数は2〜1,000,000にしてください。', flags: MessageFlags.Ephemeral });

            const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * faces) + 1);
            const total = rolls.reduce((a, b) => a + b, 0);

            const embed = new EmbedBuilder()
                .setTitle(`🎲 ${notation.toUpperCase()}`)
                .setColor(0xE74C3C)
                .addFields(
                    { name: '結果', value: count === 1
                        ? `**${total}**`
                        : rolls.map((r, i) => `ダイス${i + 1}: **${r}**`).join('\n')
                    },
                    ...(count > 1 ? [
                        { name: '合計', value: `**${total}**`, inline: true },
                        { name: '平均', value: `**${(total / count).toFixed(2)}**`, inline: true }
                    ] : [])
                )
                .setFooter({ text: `${user.username} が振りました` });

            await interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'claim') {
            const item = options.getString('content');

            // 当選者本人のデータを探す
            let winnerUserId = null;
            let winnerData = null;
            let winnerIdx = -1;

            // まず実行者自身が当選者か確認
            const selfData = giveawayWinners.get(user.id) || [];
            const selfIdx = selfData.findIndex(i => i.title === item && (i.expire === null || i.expire > Date.now()));
            if (selfIdx !== -1) {
                winnerUserId = user.id;
                winnerData = selfData;
                winnerIdx = selfIdx;
            } else {
                // ロール所持者として他の当選者データを探す
                for (const [wId, wArr] of giveawayWinners.entries()) {
                    const idx = wArr.findIndex(i => i.title === item && (i.expire === null || i.expire > Date.now()) && i.roleId && member.roles.cache.has(i.roleId));
                    if (idx !== -1) {
                        winnerUserId = wId;
                        winnerData = wArr;
                        winnerIdx = idx;
                        break;
                    }
                }
            }

            if (winnerIdx === -1) return interaction.reply({ content: '有効な当選データがありません。', flags: MessageFlags.Ephemeral });

            const existing = guild.channels.cache.find(c => 
                c.name.startsWith('claim-') && c.name.toLowerCase().includes(user.username.toLowerCase())
            );
            if (existing) return interaction.reply({ content: `既に受取用チャンネルがあります: ${existing}`, flags: MessageFlags.Ephemeral });

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const roleId = winnerData[winnerIdx].roleId;
                const category = await getCategory(guild, '---claim---');
                const permOverwrites = [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                ];
                if (winnerUserId !== user.id) {
                    permOverwrites.push({ id: winnerUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
                }
                if (roleId) {
                    permOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
                }
                const claimCh = await guild.channels.create({
                    name: `claim-${user.username}`,
                    parent: category.id,
                    permissionOverwrites,
                });
                winnerData.splice(winnerIdx, 1);
                if (winnerData.length === 0) giveawayWinners.delete(winnerUserId);
                else giveawayWinners.set(winnerUserId, winnerData);

                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ch').setLabel('クローズ').setStyle(ButtonStyle.Danger));
                await interaction.editReply({ content: `作成しました: ${claimCh}` });
                const isProxy = winnerUserId !== user.id;
                await claimCh.send({ content: `景品: **${item}**\n当選者: <@${winnerUserId}>${isProxy ? `\n対応者: <@${user.id}>` : ''}`, components: [row] });
            } catch (err) {
                await interaction.editReply({ content: 'エラーが発生しました。' });
            }
        }

        if (commandName === 'blacklist') {
            const sub = options.getSubcommand();

            if (sub === 'add') {
                const target = options.getUser('user');
                if (giveawayBlacklist.has(target.id)) {
                    return interaction.reply({ content: `⚠️ <@${target.id}> はすでにブラックリストに登録されています。`, flags: MessageFlags.Ephemeral });
                }
                giveawayBlacklist.add(target.id);
                const embed = new EmbedBuilder()
                    .setTitle('🚫 ブラックリスト追加')
                    .setDescription(`<@${target.id}> をギブアウェイBANリストに追加しました。`)
                    .setColor(0xFF0000)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
            }

            if (sub === 'remove') {
                const target = options.getUser('user');
                if (!giveawayBlacklist.has(target.id)) {
                    return interaction.reply({ content: `⚠️ <@${target.id}> はブラックリストに登録されていません。`, flags: MessageFlags.Ephemeral });
                }
                giveawayBlacklist.delete(target.id);
                const embed = new EmbedBuilder()
                    .setTitle('✅ ブラックリスト解除')
                    .setDescription(`<@${target.id}> をギブアウェイBANリストから削除しました。`)
                    .setColor(0x00FF00)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
            }

            if (sub === 'list') {
                const embed = new EmbedBuilder()
                    .setTitle('🚫 ギブアウェイ BANリスト')
                    .setColor(0xFF6600)
                    .setTimestamp();
                if (giveawayBlacklist.size === 0) {
                    embed.setDescription('現在、ブラックリストに登録されているユーザーはいません。');
                } else {
                    embed.setDescription([...giveawayBlacklist].map((id, i) => `${i + 1}. <@${id}>`).join('\n'));
                    embed.setFooter({ text: `合計 ${giveawayBlacklist.size} 人` });
                }
                await interaction.reply({ embeds: [embed] });
            }
        }
    }

    if (interaction.isAutocomplete()) {
        const selfItems = (giveawayWinners.get(interaction.user.id) || [])
            .filter(i => i.expire === null || i.expire > Date.now());

        // ロール所持者として対応できる他の当選者の景品も候補に含める
        const roleItems = [];
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (member) {
            for (const [wId, wArr] of giveawayWinners.entries()) {
                if (wId === interaction.user.id) continue;
                for (const i of wArr) {
                    if ((i.expire === null || i.expire > Date.now()) && i.roleId && member.roles.cache.has(i.roleId)) {
                        roleItems.push({ name: `${i.title} (代理対応)`, value: i.title });
                    }
                }
            }
        }

        const selfMapped = selfItems.map(i => ({ name: i.title, value: i.title }));
        const combined = [...selfMapped, ...roleItems].slice(0, 25);
        await interaction.respond(combined);
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
                await interaction.reply({ content: 'DMを確認してください。', flags: MessageFlags.Ephemeral });
            } catch (e) {
                await interaction.reply({ content: 'DMを送れませんでした。設定を確認してください。', flags: MessageFlags.Ephemeral });
            }
        }

        if (customId.startsWith('t_open_')) {
            const existing = guild.channels.cache.find(c => 
                (c.name.startsWith('ticket-') || c.name.startsWith('claim-')) && 
                c.name.toLowerCase().includes(user.username.toLowerCase())
            );
            if (existing) return interaction.reply({ content: `既にチャンネルがあります: ${existing}`, flags: MessageFlags.Ephemeral });

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
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
                await interaction.editReply({ content: `作成しました: ${ticketCh}` });
                await ticketCh.send({ content: `<@${user.id}> さん、要件をどうぞ。`, components: [row] });
            } catch (err) {
                console.error(err);
                if (interaction.deferred) await interaction.editReply({ content: 'エラーが発生しました。' });
            }
        }

        if (customId === 'close_ch') {
            await interaction.deferUpdate();
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
