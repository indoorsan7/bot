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
    partials: [Partials.Channel] 
});

const DONUT_API_KEY = "f2e5c051e9d24406a86696f5cf5a77ca";
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
client.once('clientReady', async () => {
    console.log(`${client.user.tag} が正常に起動しました！`);
    
    const commands = [
        {
            name: 'stats',
            description: 'DonutSMPのプレイヤー情報を表示します',
            options: [
                { name: 'mcid', description: 'Minecraftのユーザー名', type: 3, required: true }
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
        console.log('スラッシュコマンド（statsを含む）を登録しました。');
    } catch (error) {
        console.error('コマンド登録中にエラーが発生しました:', error);
    }
});

// --- インタラクション処理 ---
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options, guild, user } = interaction;

        // --- Stats Command ---
        if (commandName === 'stats') {
            const mcid = options.getString('mcid');
            await interaction.deferReply();

            try {
                // DonutSMP API Call
                const response = await fetch(`https://api.donutsmp.net/v1/stats/${mcid}`, {
                    headers: { 'Authorization': DONUT_API_KEY }
                });

                if (!response.ok) {
                    if (response.status === 404) {
                        return interaction.editReply(`❌ プレイヤー \`${mcid}\` は見つかりませんでした。`);
                    }
                    throw new Error(`API Error: ${response.status}`);
                }

                const data = await response.json();
                
                const embed = new EmbedBuilder()
                    .setTitle(`🍩 DonutSMP Stats: ${data.username || mcid}`)
                    .setThumbnail(`https://mc-heads.net/avatar/${mcid}`)
                    .setColor(0xFFA500)
                    .addFields(
                        { name: '💵 所持金', value: `$${(data.money || 0).toLocaleString()}`, inline: true },
                        { name: '💎 Shards', value: `${(data.shards || 0).toLocaleString()}`, inline: true },
                        { name: '\u200B', value: '\u200B', inline: true },
                        { name: '⚔️ Kills', value: `${data.kills || 0}`, inline: true },
                        { name: '☠️ Deaths', value: `${data.deaths || 0}`, inline: true },
                        { name: '🔥 K/D', value: `${data.deaths ? (data.kills / data.deaths).toFixed(2) : data.kills.toString()}`, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'DonutSMP Official API' });

                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                await interaction.editReply('❌ データの取得中にエラーが発生しました。APIサーバーが混み合っている可能性があります。');
            }
        }

        // --- Other Commands ---
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
            if (!hasButtons) return interaction.reply({ content: 'ボタンを設定してください。', flags: MessageFlags.Ephemeral });
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'gs') {
            const title = options.getString('title');
            const durationInput = options.getString('time');
            const duration = durationInput ? ms(durationInput) : null;
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

            const existing = guild.channels.cache.find(c => 
                c.name.startsWith('claim-') && c.name.toLowerCase().includes(user.username.toLowerCase())
            );
            if (existing) return interaction.reply({ content: `既に受取用チャンネルがあります: ${existing}`, flags: MessageFlags.Ephemeral });

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
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
                await claimCh.send({ content: `<@${user.id}> さんの景品: **${item}**`, components: [row] });
            } catch (err) {
                await interaction.editReply({ content: 'エラーが発生しました。' });
            }
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
