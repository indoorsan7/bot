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
        GatewayIntentBits.DirectMessages 
    ],
    partials: [Partials.Channel, Partials.Message] 
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
        await client.application.commands.set(commands);
        console.log('--- スラッシュコマンドの登録完了 ---');
    } catch (error) {
        console.error('コマンド登録中にエラーが発生しました:', error);
    }
});

// --- DM認証処理 ---
client.on('messageCreate', async message => {
    if (message.author.bot || message.guild) return; 
    const data = verifyingUsers.get(message.author.id);
    if (!data) return;

    // 全角数字を半角に変換
    const content = message.content.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    
    if (parseInt(content) === data.answer) {
        try {
            const guild = await client.guilds.fetch(data.guildId);
            const member = await guild.members.fetch(message.author.id);
            const role = await guild.roles.fetch(data.roleId);
            if (role) {
                await member.roles.add(role);
                await message.reply('✅ 正解です！認証が完了し、ロールが付与されました。');
                verifyingUsers.delete(message.author.id);
            }
        } catch (e) {
            await message.reply('❌ サーバー内でエラーが発生しました。BOTのロール順序を確認してください。');
        }
    } else {
        await message.reply('❌ 答えが違います。もう一度数値を入力してください。');
    }
});

// --- インタラクション処理 ---
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName, options, guild, user } = interaction;

            if (commandName === 'verify') {
                const role = options.getRole('role');
                const embed = new EmbedBuilder()
                    .setTitle('✅ 認証システム')
                    .setDescription('下のボタンを押すと、DMで計算問題が出題されます。')
                    .setColor(0x00FF00);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`verify_start_${role.id}`).setLabel('認証する').setStyle(ButtonStyle.Success)
                );
                await interaction.reply({ embeds: [embed], components: [row] }).catch(() => {});
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
                await interaction.reply({ embeds: [embed], components: [row] }).catch(() => {});
            }

            if (commandName === 'gs') {
                const title = options.getString('title');
                const timeInput = options.getString('time');
                const duration = timeInput ? ms(timeInput) : null;
                const num = options.getInteger('number');
                if (!duration) return interaction.reply({ content: '期間が不正です。', flags: MessageFlags.Ephemeral });

                await interaction.deferReply();
                const sponsor = options.getString('sponsor');
                const delInput = options.getString('delete_time');
                const endTime = Math.floor((Date.now() + duration) / 1000);

                const createEmbed = (currentNum, finished = false, winnerList = []) => {
                    let desc = finished ? `**ギブアウェイ終了**\n\n` : `${options.getString('description')}\n\n`;
                    desc += `当選人数: **${num}**\n終了: <t:${endTime}:${finished ? 'f' : 'R'}>\n参加者: **${currentNum}**人\n`;
                    if (sponsor) desc += `提供: ${sponsor.startsWith('<@') ? sponsor : `<@${sponsor}>`}\n`;
                    if (finished) desc += `\n**当選者:**\n${winnerList.length > 0 ? winnerList.join('\n') : 'なし'}`;
                    return new EmbedBuilder().setTitle(finished ? `【終了】${title}` : `🎉 GIVEAWAY: ${title}`).setDescription(desc).setColor(finished ? 0x2C2F33 : 0xFFD700);
                };

                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gs_join').setLabel('参加/辞退').setStyle(ButtonStyle.Success).setEmoji('🎁'));
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
                    await msg.edit({ embeds: [createEmbed(participants.size, true, winnerMentions)], components: [] }).catch(() => {});
                    if (winners.length > 0) {
                        interaction.channel.send(`🎊 **${title}** 当選: ${winnerMentions.join(' ')}\n\`/claim\` で受取可能`);
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
                if (idx === -1) return interaction.reply({ content: '有効な当選景品がありません。', flags: MessageFlags.Ephemeral });

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const category = await getCategory(guild, '---claim---');
                const ch = await guild.channels.create({
                    name: `claim-${user.username}`,
                    parent: category.id,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    ],
                });
                userData.splice(idx, 1);
                giveawayWinners.set(user.id, userData);
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ch').setLabel('閉じる').setStyle(ButtonStyle.Danger));
                await interaction.editReply({ content: `受取チャンネルを作成しました: ${ch}` });
                await ch.send({ content: `<@${user.id}> さん: **${item}**`, components: [row] });
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
                // 返信が遅れる可能性を考慮して先にdefer
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const roleId = customId.replace('verify_start_', '');
                const n1 = Math.floor(Math.random() * 9) + 1;
                const n2 = Math.floor(Math.random() * 9) + 1;
                const answer = n1 + n2;
                try {
                    await user.send(`**${guild.name}** 認証: **${n1} + ${n2} = ?** を数字で入力してください。`);
                    verifyingUsers.set(user.id, { answer, roleId, guildId: guild.id });
                    await interaction.editReply({ content: 'DMに問題を送信しました。' });
                } catch (e) {
                    await interaction.editReply({ content: 'DMを送信できませんでした。設定を確認してください。' });
                }
            }

            if (customId.startsWith('t_open_')) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const label = customId.replace('t_open_', '');
                const category = await getCategory(guild, '---ticket---');
                const ch = await guild.channels.create({
                    name: `ticket-${label}-${user.username}`,
                    parent: category.id,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    ],
                });
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ch').setLabel('閉じる').setStyle(ButtonStyle.Danger));
                await interaction.editReply({ content: `チケットを作成しました: ${ch}` });
                await ch.send({ content: `<@${user.id}> さん、要件をご記入ください。`, components: [row] });
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
    } catch (error) {
        console.error('インタラクションエラー:', error);
    }
});

client.on('error', console.error);

client.login(process.env.DISCORD_TOKEN);
