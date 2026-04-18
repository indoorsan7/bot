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

// --- 設定 ---
const DEVELOPER_ID = '1307150820432810017'; // ここを書き換えてください

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
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages // 認証回答受信用
    ],
    partials: [Partials.Channel] // DMを確実に受け取るために必要
});

// データ保持用
let giveawayWinners = new Map();
const verifyingUsers = new Map(); // { userId: { answer: number, roleId: string, guildId: string } }

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
            name: 'data',
            description: 'データのバックアップと復元（開発者専用）',
            options: [
                { name: 'save', description: '全データを文字列化してDMに送信します', type: 1 },
                {
                    name: 'load',
                    description: '文字列データから内部データを復元します',
                    type: 1,
                    options: [{ name: 'key', description: '復元用文字列', type: 3, required: true }]
                }
            ]
        }
    ];
    await client.application.commands.set(commands);
});

// --- DMでの回答処理 (認証用) ---
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
            await message.reply('❌ ロールの付与に失敗しました。BOTの権限を確認してください。');
        }
    } else {
        await message.reply('❌ 答えが違います。半角数字だけで回答してください。');
    }
});

// --- インタラクション処理 ---
client.on('interactionCreate', async interaction => {
    
    // スラッシュコマンド
    if (interaction.isChatInputCommand()) {
        const { commandName, options, guild, user, member } = interaction;

        // 【Data Command】
        if (commandName === 'data') {
            if (user.id !== DEVELOPER_ID) return interaction.reply({ content: '権限がありません。', ephemeral: true });

            if (options.getSubcommand() === 'save') {
                const backup = {
                    giveaway: Array.from(giveawayWinners.entries()),
                    timestamp: Date.now()
                };
                const json = JSON.stringify(backup);
                try {
                    await user.send(`**バックアップデータ:**\n\`\`\`\n${json}\n\`\`\``);
                    await interaction.reply({ content: 'データをDMに送信しました。', ephemeral: true });
                } catch (e) {
                    await interaction.reply({ content: 'DMを送信できませんでした。', ephemeral: true });
                }
            } else if (options.getSubcommand() === 'load') {
                try {
                    const key = options.getString('key');
                    const data = JSON.parse(key);
                    giveawayWinners = new Map(data.giveaway);
                    await interaction.reply({ content: `✅ データを復元しました (${giveawayWinners.size}件)`, ephemeral: true });
                } catch (e) {
                    await interaction.reply({ content: '❌ 不正なデータ形式です。', ephemeral: true });
                }
            }
        }

        // 【Verify】
        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder()
                .setTitle('✅ メンバー認証')
                .setDescription('下のボタンを押すとDMで計算問題が送られます。\n正解するとロールが付与されます。')
                .setColor(0x00FF00);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`v_start_${role.id}`).setLabel('認証を開始').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

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

            await interaction.deferReply();
            const endTime = Math.floor((Date.now() + duration) / 1000);
            const sponsorMention = sponsor ? (sponsor.startsWith('<@') ? sponsor : `<@${sponsor}>`) : null;

            const createEmbed = (currentNum, finished = false, winnerList = []) => {
                let desc = finished ? `**このギブアウェイは終了しました。**\n\n` : `${options.getString('description')}\n\n`;
                desc += `当選者数: **${num}**名\n終了: <t:${endTime}:${finished ? 'f' : 'R'}>\n参加人数: **${currentNum}**人\n`;
                if (sponsorMention) desc += `スポンサー: ${sponsorMention}\n`;
                if (finished) desc += `\n**当選者:**\n${winnerList.length > 0 ? winnerList.join('\n') : 'なし'}`;
                return new EmbedBuilder().setTitle(finished ? `【終了】${title}` : `🎉 GIVEAWAY: ${title}`).setDescription(desc).setColor(finished ? 0x2C2F33 : 0xFFD700);
            };

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gs_join').setLabel('参加 / 辞退').setStyle(ButtonStyle.Success).setEmoji('🎁'));
            const response = await interaction.editReply({ embeds: [createEmbed(0)], components: [row], withResponse: true });
            const msg = response.resource ? response.resource.message : response;
            const participants = new Set();
            const collector = msg.createMessageComponentCollector({ time: duration });

            collector.on('collect', async i => {
                participants.has(i.user.id) ? participants.delete(i.user.id) : participants.add(i.user.id);
                await i.update({ embeds: [createEmbed(participants.size)] });
            });

            collector.on('end', async () => {
                const winners = Array.from(participants).sort(() => 0.5 - Math.random()).slice(0, num);
                const winnerMentions = winners.map(id => `<@${id}>`);
                await msg.edit({ embeds: [createEmbed(participants.size, true, winnerMentions)], components: [] });
                if (winners.length > 0) {
                    const delMs = delInput ? ms(delInput) : null;
                    interaction.channel.send(`🎊 **${title}** 当選: ${winnerMentions.join(' ')}\n\`/claim\` で受取可能${delInput ? ` (期限: ${delInput})` : ''}`);
                    winners.forEach(wId => {
                        if (!giveawayWinners.has(wId)) giveawayWinners.set(wId, []);
                        giveawayWinners.get(wId).push({ title, expire: delMs ? Date.now() + delMs : null, guild: guild.name });
                    });
                }
            });
        }

        // 【Claim】
        if (commandName === 'claim') {
            const item = options.getString('content');
            let userData = giveawayWinners.get(user.id) || [];
            const idx = userData.findIndex(i => i.title === item && (i.expire === null || i.expire > Date.now()));
            if (idx === -1) return interaction.reply({ content: '有効な当選データがありません。', ephemeral: true });

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
            userData.length === 0 ? giveawayWinners.delete(user.id) : giveawayWinners.set(user.id, userData);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ch').setLabel('クローズ').setStyle(ButtonStyle.Danger));
            await interaction.reply({ content: 'チケットを作成しました。', ephemeral: true });
            claimCh.send({ content: `<@${user.id}> さん、景品 **${item}** の受取用窓口です。`, components: [row] });
        }
    }

    // オートコンプリート
    if (interaction.isAutocomplete()) {
        const userData = giveawayWinners.get(interaction.user.id) || [];
        const active = userData.filter(i => i.expire === null || i.expire > Date.now());
        await interaction.respond(active.slice(0, 25).map(i => ({ name: `[${i.guild}] ${i.title}`, value: i.title })));
    }

    // ボタン処理
    if (interaction.isButton()) {
        const { customId, guild, channel, user, member } = interaction;

        if (customId.startsWith('v_start_')) {
            const roleId = customId.replace('v_start_', '');
            const n1 = Math.floor(Math.random() * 9) + 1, n2 = Math.floor(Math.random() * 9) + 1;
            try {
                await user.send(`**${guild.name}** 認証用計算問題:\n\n**${n1} + ${n2} = ?**\n\n数字だけで返信してください。`);
                verifyingUsers.set(user.id, { answer: n1 + n2, roleId, guildId: guild.id });
                await interaction.reply({ content: 'DMを確認してください。', ephemeral: true });
            } catch {
                await interaction.reply({ content: 'DMを送信できませんでした。', ephemeral: true });
            }
        }

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
            ticketCh.send({ content: `<@${user.id}> 要件を入力してください。`, components: [row] });
        }

        if (customId === 'close_ch') {
            await interaction.reply('チャンネルを凍結しました。');
            await channel.permissionOverwrites.set([{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }]);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_ch').setLabel('削除').setStyle(ButtonStyle.Danger));
            await channel.send({ content: '管理者が削除ボタンを押すと消去されます。', components: [row] });
        }

        if (customId === 'delete_ch') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '権限不足', ephemeral: true });
            const pId = channel.parentId;
            await channel.delete();
            if (pId) await checkAndDeleteCategory(guild, pId);
        }
    }
});

client.login(process.env.DISCORD_TOKEN).catch(console.error);
