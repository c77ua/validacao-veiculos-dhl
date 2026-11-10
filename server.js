const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const SPREADSHEET_ID = '1IJt05Tr1rJf5GQJ76BwPKKf4rR_czxiYElOU9uPlBr0';

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'credentials.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

async function getSheetsClient() {
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

// ===== ROTAS DA API =====

// 1. Rota de Login (COM VALIDAÇÃO DE CARGO DA PLANILHA - COLUNA C)
app.post('/api/login', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { usuario, senha, cargo } = req.body || {};
    if (!usuario || !senha || !cargo) {
      return res.status(400).json({ error: 'Preencha usuário, senha e cargo.' });
    }

    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const abas = meta.data.sheets.map(s => s.properties.title);
    const nomeAbaUsuarios = abas.find(n => n.trim().toLowerCase().includes('usuario'));

    if (!nomeAbaUsuarios) {
      return res.status(404).json({ error: 'Aba de usuários não encontrada.' });
    }

    // Leitura das Colunas A (Usuário), B (Senha) e C (Cargo)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${nomeAbaUsuarios}'!A2:C`
    });

    const rows = response.data.values || [];
    const usuarioEncontrado = rows.find(r => {
      const uPlanilha = String(r[0] || '').trim().toLowerCase();
      const sPlanilha = String(r[1] || '').trim();
      return uPlanilha === String(usuario).trim().toLowerCase() && sPlanilha === String(senha).trim();
    });

    if (!usuarioEncontrado) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    // Validação estrita do Cargo (Coluna C da Planilha)
    const cargoCadastrado = String(usuarioEncontrado[2] || '').trim().toUpperCase();
    const cargoSelecionado = String(cargo).trim().toUpperCase();

    if (cargoCadastrado !== cargoSelecionado) {
      return res.status(401).json({ error: 'O cargo selecionado não corresponde ao cadastrado para este usuário.' });
    }

    const podeReportar = ['ASSISTENTE', 'OPERAÇÃO', 'COORDENADOR', 'GESTÃO', 'ADM'].includes(cargoCadastrado);

    return res.status(200).json({
      usuario: usuarioEncontrado[0],
      cargo: cargoCadastrado,
      podeReportar
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro de autenticação: ' + err.message });
  }
});

// 2. Rota do Pátio Pendente
app.get('/api/patio', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'PATIO_PENDENTE!A2:X'
    });

    const rows = response.data.values || [];
    const patio = rows
      .filter(r => r[0] && String(r[0]).trim() !== '')
      .map(r => ({
        protocolo: r[0] || '',
        routeId: r[1] || '',
        rota: r[2] || '',
        data: r[3] || '',
        transportadora: r[4] || '',
        perfilRosterizado: r[5] || '',
        placa: r[6] || '',
        placaReboque: r[7] || '',
        motorista: r[8] || '',
        siglaOrigem: r[9] || '',
        origem: r[10] || '',
        prazoEta: r[11] || '',
        prazoCpt: r[12] || '',
        destino: r[13] || '',
        perfilFisico: r[14] || '',
        capacidade: r[15] || '',
        horaCpt: r[16] || '',
        dhChegada: r[17] || '',
        dhEntrada: r[18] || '',
        dhDoca: r[19] || '',
        dhSaidaDoca: r[20] || '',
        doca: r[21] || '',
        setorAloca: r[22] || '',
        status: r[23] || ''
      }));

    return res.status(200).json(patio);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar pátio pendente.' });
  }
});

// 3. Rota dos Relatórios (Lê de A2 até AP)
app.get('/api/reports', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'REPORTS!A2:AP'
    });

    const rows = response.data.values || [];
    const reports = rows
      .filter(r => (r[0] && String(r[0]).trim() !== '') || (r[2] && String(r[2]).trim() !== ''))
      .map(r => ({
        dataHora: r[0] || '',
        data: r[1] || '',
        protocolo: r[2] || '',
        prazoEta: r[3] || '',
        prazoCpt: r[4] || '',
        origem: r[5] || '',
        destino: r[6] || '',
        responsavel: r[7] || '',
        horarioChegada: r[8] || '',
        horarioSaida: r[9] || '',
        transportadora: r[10] || '',
        placa: r[11] || '',
        perfilSolicitado: r[12] || '',
        perfilRosterizado: r[13] || '',
        corda: r[14] || '',
        qtsCorda: r[15] || '',
        l1: r[16] || '',
        l2: r[17] || '',
        l3: r[18] || '',
        l4: r[19] || '',
        l5: r[20] || '',
        fotoLacre: r[21] || '',
        inicioPreenchimento: r[22] || '',
        tipoVeiculo: r[23] || '',
        pacotes: r[24] || '',
        pallets: r[25] || '',
        qtdGaylord: r[26] || '',
        kitManga: r[27] || '',
        granel: r[28] || '',
        plv: r[29] || '',
        ocupadas: r[30] || '',
        fimPreenchimento: r[31] || '',
        fotoBau: r[32] || '',
        fotoRomaneio: r[33] || '',
        status: r[34] || '',
        horaLancamento: r[35] || '',
        observacao: r[36] || '',
        doca: r[37] || '',
        substatus: r[38] || '',
        ocupacao: r[39] || '',
        infrutifero: r[40] || '', // Coluna AO
        status1: r[41] || ''       // Coluna AP
      }));

    return res.status(200).json(reports);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar relatórios.' });
  }
});

// 4. Rota para Salvar Report (Grava todos os dados do veículo, inclusive se for Infrutífero)
app.post('/api/salvar-report', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const d = req.body || {};
    const agora = new Date().toLocaleString('pt-BR');

    const novaLinha = [
      agora,                           // Coluna A: ID_REPORT / DataHora
      d.data || agora.split(' ')[0],   // Coluna B: DATA OPERAÇÃO
      d.protocolo || '',               // Coluna C: PROTOCOLO
      d.prazoEta || '',                // Coluna D: PRAZO_ETA
      d.prazoCpt || '',                // Coluna E: PRAZO_CPT
      d.origem || '',                  // Coluna F: ORIGEM
      d.destino || '',                 // Coluna G: DESTINO
      d.responsavel || '',             // Coluna H: RESPONSÁVEL
      d.horarioChegada || '',          // Coluna I: HORÁRIO CHEGADA
      d.horarioSaida || '',            // Coluna J: HORÁRIO SAÍDA
      d.transportadora || '',          // Coluna K: TRANSPORTADORA
      d.placa || '',                   // Coluna L: PLACA
      d.perfilSolicitado || '',        // Coluna M: PERFIL_SOLICITADO
      d.perfilRosterizado || '',       // Coluna N: PERFIL_ROSTERIZADO
      d.corda || '',                   // Coluna O: POSSUI CORDA
      d.qtsCorda || '',                // Coluna P: QTS CORDA
      d.l1 || '',                      // Coluna Q: LACRE I
      d.l2 || '',                      // Coluna R: LACRE II
      d.l3 || '',                      // Coluna S: LACRE III
      d.l4 || '',                      // Coluna T: LACRE IIII
      d.l5 || '',                      // Coluna U: LACRE IIIII
      d.fotos?.lacre || '',            // Coluna V: FOTO LACRE
      agora,                           // Coluna W: INICIO PREENCHIMENTO
      d.tipoVeiculo || '',             // Coluna X: TIPO VEÍCULO
      d.pacotes || '',                 // Coluna Y: QTD PACOTES
      d.pallets || '',                 // Coluna Z: QTD PALLETES
      d.qtdGaylord || '',              // Coluna AA: QTD GAYLORD
      d.kitManga || '',                // Coluna AB: QTD KIT MANGA
      d.granel || '',                  // Coluna AC: QTD POSIÇÃO GRANEL
      d.plv || '',                     // Coluna AD: QTD POSIÇÕES PLV
      d.ocupadas || '',                // Coluna AE: QTD POSIÇÕES OCUPADAS
      agora,                           // Coluna AF: FIM PREENCHIMENTO
      d.fotos?.bau || '',              // Coluna AG: FOTO BÁU
      d.fotos?.romaneio || '',         // Coluna AH: FOTO ROMANEIO
      'REPORTADO',                     // Coluna AI: STATUS
      agora,                           // Coluna AJ: HORA_LANÇAMENTO
      d.observacao || '',              // Coluna AK: OBSERVAÇÃO
      d.doca || '',                    // Coluna AL: DOCA
      d.substatus || '',               // Coluna AM: SUBSTATUS
      d.ocupacao || '',                // Coluna AN: OCUPAÇÃO
      d.infrutifero || ''              // Coluna AO: INFRUTIFERO
    ];

    const sheets = await getSheetsClient();
    
    // Procura a primeira linha livre inspecionando a Coluna A
    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'REPORTS!A:A'
    });
    
    const totalLinhasPreenchidas = colA.data.values ? colA.data.values.length : 1;
    const proximaLinha = totalLinhasPreenchidas + 1;

    // Atualiza estritamente entre A e AO (deixando a AP livre para a fórmula)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `REPORTS!A${proximaLinha}:AO${proximaLinha}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [novaLinha] }
    });

    return res.status(200).json({ ok: true, message: 'Report salvo com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar report:', err.message);
    return res.status(500).json({ error: 'Falha ao salvar report no Google Sheets.' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, req, res, next) => res.status(500).json({ error: 'Erro interno no servidor.' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor DHL rodando na porta ${PORT}`));