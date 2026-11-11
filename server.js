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

let auth;
if (process.env.GOOGLE_CREDENTIALS) {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
} else {
  auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

async function getSheetsClient() {
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

// ===== ROTAS DA API =====

// 1. Rota de Login
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

// 3. Rota dos Relatórios
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
        infrutifero: r[40] || '',
        status1: r[41] || ''
      }));

    return res.status(200).json(reports);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar relatórios.' });
  }
});

// 4. Rota para Salvar Report
app.post('/api/salvar-report', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const d = req.body || {};
    const agora = new Date().toLocaleString('pt-BR');

    const novaLinha = [
      agora,
      d.data || agora.split(' ')[0],
      d.protocolo || '',
      d.prazoEta || '',
      d.prazoCpt || '',
      d.origem || '',
      d.destino || '',
      d.responsavel || '',
      d.horarioChegada || '',
      d.horarioSaida || '',
      d.transportadora || '',
      d.placa || '',
      d.perfilSolicitado || '',
      d.perfilRosterizado || '',
      d.corda || '',
      d.qtsCorda || '',
      d.l1 || '',
      d.l2 || '',
      d.l3 || '',
      d.l4 || '',
      d.l5 || '',
      d.fotos?.lacre || '',
      agora,
      d.tipoVeiculo || '',
      d.pacotes || '',
      d.pallets || '',
      d.qtdGaylord || '',
      d.kitManga || '',
      d.granel || '',
      d.plv || '',
      d.ocupadas || '',
      agora,
      d.fotos?.bau || '',
      d.fotos?.romaneio || '',
      'REPORTADO',
      agora,
      d.observacao || '',
      d.doca || '',
      d.substatus || '',
      d.ocupacao || '',
      d.infrutifero || ''
    ];

    const sheets = await getSheetsClient();
    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'REPORTS!A:A'
    });
    
    const totalLinhasPreenchidas = colA.data.values ? colA.data.values.length : 1;
    const proximaLinha = totalLinhasPreenchidas + 1;

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

// 5. Rota para Editar Report
app.put('/api/editar-report', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const d = req.body || {};
    if (!d.protocolo) {
      return res.status(400).json({ error: 'Protocolo é obrigatório para atualização.' });
    }

    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'REPORTS!A2:C'
    });

    const rows = response.data.values || [];
    const indexLinha = rows.findIndex(r => String(r[2] || '').trim() === String(d.protocolo).trim());

    if (indexLinha === -1) {
      return res.status(404).json({ error: 'Report com o protocolo informado não foi encontrado.' });
    }

    const numLinha = indexLinha + 2;
    const eInfrutifero = String(d.infrutifero || '').trim().toUpperCase() === 'SIM';

    const linhaEditada = [
      new Date().toLocaleString('pt-BR'),
      d.data || '',
      d.protocolo,
      d.prazoEta || '',
      d.prazoCpt || '',
      d.origem || '',
      d.destino || '',
      d.responsavel || '',
      d.horarioChegada || '',
      d.horarioSaida || '',
      d.transportadora || '',
      d.placa || '',
      d.perfilSolicitado || '',
      d.perfilRosterizado || '',
      eInfrutifero ? '' : (d.corda || ''),
      d.qtsCorda || '',
      eInfrutifero ? '' : (d.l1 || ''),
      eInfrutifero ? '' : (d.l2 || ''),
      eInfrutifero ? '' : (d.l3 || ''),
      eInfrutifero ? '' : (d.l4 || ''),
      eInfrutifero ? '' : (d.l5 || ''),
      eInfrutifero ? '' : (d.fotos?.lacre || ''),
      new Date().toLocaleString('pt-BR'),
      d.tipoVeiculo || '',
      eInfrutifero ? '' : (d.pacotes || ''),
      eInfrutifero ? '' : (d.pallets || ''),
      eInfrutifero ? '' : (d.qtdGaylord || ''),
      eInfrutifero ? '' : (d.kitManga || ''),
      eInfrutifero ? '' : (d.granel || ''),
      eInfrutifero ? '' : (d.plv || ''),
      eInfrutifero ? '' : (d.ocupadas || ''),
      new Date().toLocaleString('pt-BR'),
      eInfrutifero ? '' : (d.fotos?.bau || ''),
      eInfrutifero ? '' : (d.fotos?.romaneio || ''),
      'REPORTADO',
      new Date().toLocaleString('pt-BR'),
      d.observacao || '',
      d.doca || '',
      d.substatus || '',
      d.ocupacao || '',
      d.infrutifero || ''
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `REPORTS!A${numLinha}:AO${numLinha}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [linhaEditada] }
    });

    return res.status(200).json({ ok: true, message: 'Report atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao editar report:', err.message);
    return res.status(500).json({ error: 'Falha ao atualizar report no Google Sheets.' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, req, res, next) => res.status(500).json({ error: 'Erro interno no servidor.' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor DHL rodando na porta ${PORT}`));