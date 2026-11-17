process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

// Carrega as variáveis de ambiente do ficheiro .env
try { require('dotenv').config(); } catch (e) {}

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Configuração segura do Supabase usando as variáveis do .env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  global: {
    fetch: fetch,
    headers: { 'x-application-name': 'dhl-validacao' },
  },
});

console.log('✅ Cliente Supabase inicializado com sucesso!');

// ===== FUNÇÃO INTELIGENTE DE LEITURA E MAPEAMENTO DO GOOGLE SHEETS =====
async function lerPlanilhaGoogleMapeada() {
  try {
    let credentials;
    const caminhoCredenciaisLocal = path.join(__dirname, 'credentials.json');

    if (fs.existsSync(caminhoCredenciaisLocal)) {
      const arquivoConteudo = fs.readFileSync(caminhoCredenciaisLocal, 'utf8');
      credentials = JSON.parse(arquivoConteudo);
    } else {
      let rawCreds = process.env.GOOGLE_CREDENTIALS;
      if (!rawCreds) {
        throw new Error("Credenciais do Google não encontradas nem localmente nem nas variáveis de ambiente.");
      }
      credentials = typeof rawCreds === 'string' ? JSON.parse(rawCreds) : rawCreds;
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Planilha MEGAS LANÇAMENTOS, Aba PATIO_PENDENTE
    const spreadsheetId = '1IJt05Tr1rJf5GQJ76BwPKKf4rR_czxiYElOU9uPlBr0';
    const range = 'PATIO_PENDENTE!A1:AQ';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return [];

    const cabecalhos = rows[0].map(h => String(h || '').trim().toLowerCase());
    
    function getValorPorNome(linha, possiveisNomes) {
      for (const nome of possiveisNomes) {
        const index = cabecalhos.indexOf(nome.toLowerCase());
        if (index !== -1 && linha[index] !== undefined) {
          return String(linha[index] || '').trim();
        }
      }
      return '';
    }

    const registros = [];
    for (let i = 1; i < rows.length; i++) {
      const linha = rows[i];
      const protocolo = getValorPorNome(linha, ['protocolo', 'protocol']);
      if (!protocolo) continue;

      registros.push({
        protocolo: protocolo,
        route_id: getValorPorNome(linha, ['route_id', 'route id', 'id rota']),
        rota: getValorPorNome(linha, ['rota', 'route']),
        data: getValorPorNome(linha, ['data', 'date']),
        transportadora: getValorPorNome(linha, ['transportadora', 'transporte', 'carrier']),
        perfil_rosterizado: getValorPorNome(linha, ['perfil rosterizado', 'perfil_rosterizado', 'rosterizado']),
        placa: getValorPorNome(linha, ['placa_cavalo', 'placa cavalo', 'cavalo', 'placa', 'plate']),
        placa_reboque: getValorPorNome(linha, ['placa reboque', 'placa_reboque', 'reboque']),
        motorista: getValorPorNome(linha, ['motorista', 'driver']),
        sigla_origem: getValorPorNome(linha, ['sigla origem', 'sigla_origem']),
        origem: getValorPorNome(linha, ['origem', 'origin']),
        prazo_eta: getValorPorNome(linha, ['prazo eta', 'eta', 'prazo_eta']),
        prazo_cpt: getValorPorNome(linha, ['prazo cpt', 'cpt', 'prazo_cpt']),
        destino: getValorPorNome(linha, ['destino', 'destination']),
        perfil_fisico: getValorPorNome(linha, ['perfil fisico', 'perfil_fisico', 'perfil físico']),
        capacidade: getValorPorNome(linha, ['capacidade', 'capacity']),
        hora_cpt: getValorPorNome(linha, ['hora cpt', 'hora_cpt']),
        dh_chegada: getValorPorNome(linha, ['dh chegada', 'dh_chegada', 'data chegada', 'chegada']),
        dh_entrada: getValorPorNome(linha, ['dh entrada', 'dh_entrada', 'entrada']),
        dh_doca: getValorPorNome(linha, ['dh doca', 'dh_doca']),
        dh_saida_doca: getValorPorNome(linha, ['dh saida doca', 'dh_saida_doca', 'saída doca']),
        doca: getValorPorNome(linha, ['doca', 'dock']),
        setor_aloca: getValorPorNome(linha, ['setor aloca', 'setor_aloca', 'setor alocado', 'setor']),
        status: getValorPorNome(linha, ['status_1', 'status 1', 'status', 'estado']) || 'PENDENTE'
      });
    }

    return registros;
  } catch (err) {
    console.error("Erro detalhado ao ler planilha do Google:", err.message);
    throw err;
  }
}

// ===== ROTA DE SINCRONIZAÇÃO =====
app.get('/api/sincronizar-patio', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ ok: true, message: 'O pátio agora é lido diretamente do Google Sheets em tempo real!' });
});

// ===== FUNÇÃO AUXILIAR PARA SALVAR IMAGENS LOCALMENTE =====
function salvarImagemLocal(base64Data, prefixo, protocolo, req = null) {
  if (!base64Data || typeof base64Data !== 'string' || !base64Data.startsWith('data:image')) {
    return '';
  }
  if (base64Data.startsWith('http://') || base64Data.startsWith('https://')) {
    return base64Data;
  }
  try {
    const matches = base64Data.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return '';
    const extensao = matches[1].includes('png') ? 'png' : 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');
    
    const nomeFicheiro = `${prefixo}_${protocolo}_${Date.now()}.${extensao}`;
    const dirUploads = path.join(__dirname, 'public', 'uploads');
    
    if (!fs.existsSync(dirUploads)) {
      fs.mkdirSync(dirUploads, { recursive: true });
    }

    fs.writeFileSync(path.join(dirUploads, nomeFicheiro), buffer);
    
    let baseUrl = '';
    if (req) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get('host');
      baseUrl = `${protocol}://${host}`;
    }
    return `${baseUrl}/uploads/${nomeFicheiro}`;
  } catch (erro) {
    console.error("Erro ao salvar imagem:", erro);
    return '';
  }
}

// ===== ROTAS DA API (SUPABASE) =====

// 1. Rota de Login
app.post('/api/login', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { usuario, senha, cargo } = req.body || {};
    if (!usuario || !senha || !cargo) {
      return res.status(400).json({ error: 'Preencha usuário, senha e cargo.' });
    }

    const { data: users, error } = await supabase
      .from('usuarios')
      .select('*')
      .ilike('usuario', usuario.trim());

    if (error) throw new Error(error.message);

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    const user = users.find(u => String(u.senha).trim() === String(senha).trim());
    if (!user) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    const cargoCadastrado = String(user.cargo || '').trim().toUpperCase();
    const cargoSelecionado = String(cargo).trim().toUpperCase();

    if (cargoCadastrado !== cargoSelecionado) {
      return res.status(401).json({ error: `Cargo incorreto. O cargo deste usuário é ${cargoCadastrado}.` });
    }

    const podeReportar = ['ASSISTENTE', 'OPERAÇÃO', 'COORDENADOR', 'GESTÃO', 'ADM'].includes(cargoCadastrado);

    return res.status(200).json({
      usuario: user.usuario,
      cargo: cargoCadastrado,
      podeReportar
    });
  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({ error: 'Erro de autenticação: ' + err.message });
  }
});

// 2. Rota do Pátio Pendente
app.get('/api/patio', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const [rowsPatio, { data: rowsReports, error: errReports }] = await Promise.all([
      lerPlanilhaGoogleMapeada(),
      supabase.from('reports').select('protocolo')
    ]);

    if (errReports) throw new Error(errReports.message);

    const protocolosReportados = new Set();
    (rowsReports || []).forEach(r => {
      const proto = String(r.protocolo || '').trim();
      if (proto) protocolosReportados.add(proto);
    });

    const hojeStr = new Date().toLocaleDateString('pt-BR');

    const patio = (rowsPatio || [])
      .filter(r => {
        const protocolo = String(r.protocolo || '').trim();
        if (protocolo === '' || protocolosReportados.has(protocolo)) return false;

        const dataRegisto = String(r.data || '').trim();
        if (dataRegisto && !dataRegisto.includes(hojeStr) && !hojeStr.includes(dataRegisto)) {
          return false;
        }

        return true;
      })
      .map(r => ({
        protocolo: r.protocolo || '',
        routeId: r.route_id || '',
        rota: r.rota || '',
        data: r.data || '',
        transportadora: r.transportadora || '',
        perfilRosterizado: r.perfil_rosterizado || '',
        placa: r.placa || '',
        placaReboque: r.placa_reboque || '',
        motorista: r.motorista || '',
        siglaOrigem: r.sigla_origem || '',
        origem: r.origem || '',
        prazoEta: r.prazo_eta || '',
        prazoCpt: r.prazo_cpt || '',
        destino: r.destino || '',
        perfilFisico: r.perfil_fisico || '',
        capacidade: r.capacidade || '',
        horaCpt: r.hora_cpt || '',
        dhChegada: r.dh_chegada || '',
        dhEntrada: r.dh_entrada || '',
        dhDoca: r.dh_doca || '',
        dhSaidaDoca: r.dh_saida_doca || '',
        doca: r.doca || '',
        setorAloca: r.setor_aloca || '',
        status: r.status || ''
      }));

    return res.status(200).json(patio);
  } catch (err) {
    console.error('Erro ao carregar pátio do Google Sheets:', err.message);
    return res.status(500).json({ error: 'Erro ao carregar pátio pendente: ' + err.message });
  }
});

// 3. Rota dos Relatórios
app.get('/api/reports', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { data: rows, error } = await supabase.from('reports').select('*');
    if (error) throw new Error(error.message);

    const reports = (rows || []).map(r => {
      let statusFormatado = r.status || '';
      const status1Upper = String(r.status1 || '').trim().toUpperCase();
      
      if (status1Upper === 'ENVIADO' || status1Upper === 'TUDO OK') {
        statusFormatado = 'LANÇADO PELA OPERAÇÃO E PÁTIO TUDO OK';
      } else if (status1Upper) {
        statusFormatado = r.status1;
      }

      return {
        dataHora: r.data_hora || '',
        data: r.data || '',
        protocolo: r.protocolo || '',
        prazoEta: r.prazo_eta || '',
        prazoCpt: r.prazo_cpt || '',
        origem: r.origem || '',
        destino: r.destino || '',
        responsavel: r.responsavel || '',
        horarioChegada: r.horario_chegada || '',
        horarioSaida: r.horario_saida || '',
        transportadora: r.transportadora || '',
        placa: r.placa || '',
        perfilSolicitado: r.perfil_solicitado || '',
        perfilRosterizado: r.perfil_rosterizado || '',
        corda: r.corda || '',
        qtsCorda: r.qts_corda || '',
        l1: r.l1 || '', l2: r.l2 || '', l3: r.l3 || '', l4: r.l4 || '', l5: r.l5 || '',
        fotoLacre: r.foto_lacre || '',
        inicioPreenchimento: r.inicio_preenchimento || '',
        tipoVeiculo: r.tipo_veiculo || '',
        pacotes: r.pacotes || '', pallets: r.pallets || '', qtdGaylord: r.qtd_gaylord || '',
        kitManga: r.kit_manga || '', granel: r.granel || '', plv: r.plv || '', ocupadas: r.ocupadas || '',
        fimPreenchimento: r.fim_preenchimento || '',
        fotoBau: r.foto_bau || '',
        fotoRomaneio: r.foto_romaneio || '',
        status: statusFormatado,
        horaLancamento: r.hora_lancamento || '',
        observacao: r.observacao || '',
        doca: r.doca || '',
        substatus: r.substatus || '',
        ocupacao: r.ocupacao || '',
        infrutifero: r.infrutifero || '',
        status1: r.status1 || ''
      };
    });

    return res.status(200).json(reports);
  } catch (err) {
    console.error('Erro ao carregar relatórios:', err.message);
    return res.status(500).json({ error: 'Erro ao carregar relatórios.' });
  }
});

// 4. Rota para Salvar Report
app.post('/api/salvar-report', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const d = req.body || {};
    const agora = new Date().toLocaleString('pt-BR');
    const protocolo = d.protocolo || 'geral';

    let status1Calculado = 'PENDENTE';
    try {
      const registrosPlanilha = await lerPlanilhaGoogleMapeada();
      const veiculoPlanilha = registrosPlanilha.find(r => String(r.protocolo).trim() === String(protocolo).trim());
      if (veiculoPlanilha && veiculoPlanilha.status) {
        status1Calculado = veiculoPlanilha.status;
      }
    } catch (e) {
      console.error("Aviso: Não foi possível buscar o status_1 da planilha ao salvar:", e.message);
    }

    const urlLacre = salvarImagemLocal(d.fotos?.lacre, 'lacre', protocolo, req);
    const urlBau = salvarImagemLocal(d.fotos?.bau, 'bau', protocolo, req);
    const urlRomaneio = salvarImagemLocal(d.fotos?.romaneio, 'romaneio', protocolo, req);

    const novoReport = {
      data_hora: agora,
      data: d.data || agora.split(' ')[0],
      protocolo: protocolo,
      prazo_eta: d.prazoEta || '',
      prazo_cpt: d.prazoCpt || '',
      origem: d.origem || '',
      destino: d.destino || '',
      responsavel: d.responsavel || '',
      horario_chegada: d.horarioChegada || '',
      horario_saida: d.horarioSaida || '',
      transportadora: d.transportadora || '',
      placa: d.placa || '',
      perfil_solicitado: d.perfilSolicitado || '',
      perfil_rosterizado: d.perfilRosterizado || '',
      corda: d.corda || '',
      qts_corda: d.qtsCorda || '',
      l1: d.l1 || '', l2: d.l2 || '', l3: d.l3 || '', l4: d.l4 || '', l5: d.l5 || '',
      foto_lacre: urlLacre,
      inicio_preenchimento: agora,
      tipo_veiculo: d.tipoVeiculo || '',
      pacotes: d.pacotes || '', pallets: d.pallets || '', qtd_gaylord: d.qtdGaylord || '',
      kit_manga: d.kitManga || '', granel: d.granel || '', plv: d.plv || '', ocupadas: d.ocupadas || '',
      fim_preenchimento: agora,
      foto_bau: urlBau,
      foto_romaneio: urlRomaneio,
      status: 'REPORTADO',
      hora_lancamento: agora,
      observacao: d.observacao || '',
      doca: d.doca || '',
      substatus: d.substatus || '',
      ocupacao: d.ocupacao || '',
      infrutifero: d.infrutifero || '',
      status1: status1Calculado
    };

    const { error } = await supabase.from('reports').insert([novoReport]);
    if (error) throw new Error(error.message);

    return res.status(200).json({ ok: true, message: 'Report salvo com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar report:', err.message);
    return res.status(500).json({ error: 'Falha ao salvar report: ' + err.message });
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

    const protocolo = d.protocolo;
    const eInfrutifero = String(d.infrutifero || '').trim().toUpperCase() === 'SIM';

    const urlLacre = salvarImagemLocal(d.fotos?.lacre, 'lacre', protocolo, req);
    const urlBau = salvarImagemLocal(d.fotos?.bau, 'bau', protocolo, req);
    const urlRomaneio = salvarImagemLocal(d.fotos?.romaneio, 'romaneio', protocolo, req);

    const dadosAtualizados = {
      data: d.data || '',
      prazo_eta: d.prazoEta || '',
      prazo_cpt: d.prazoCpt || '',
      origem: d.origem || '',
      destino: d.destino || '',
      responsavel: d.responsavel || '',
      horario_chegada: d.horarioChegada || '',
      horario_saida: d.horarioSaida || '',
      transportadora: d.transportadora || '',
      placa: d.placa || '',
      perfil_solicitado: d.perfilSolicitado || '',
      perfil_rosterizado: d.perfilRosterizado || '',
      corda: eInfrutifero ? '' : (d.corda || ''),
      qts_corda: d.qtsCorda || '',
      l1: eInfrutifero ? '' : (d.l1 || ''),
      l2: eInfrutifero ? '' : (d.l2 || ''),
      l3: eInfrutifero ? '' : (d.l3 || ''),
      l4: eInfrutifero ? '' : (d.l4 || ''),
      l5: eInfrutifero ? '' : (d.l5 || ''),
      foto_lacre: eInfrutifero ? '' : (urlLacre || d.fotos?.lacre || ''),
      tipo_veiculo: d.tipoVeiculo || '',
      pacotes: eInfrutifero ? '' : (d.pacotes || ''),
      pallets: eInfrutifero ? '' : (d.pallets || ''),
      qtd_gaylord: eInfrutifero ? '' : (d.kitManga || ''),
      kit_manga: eInfrutifero ? '' : (d.kitManga || ''),
      granel: eInfrutifero ? '' : (d.granel || ''),
      plv: eInfrutifero ? '' : (d.plv || ''),
      ocupadas: eInfrutifero ? '' : (d.ocupadas || ''),
      foto_bau: eInfrutifero ? '' : (urlBau || d.fotos?.bau || ''),
      foto_romaneio: eInfrutifero ? '' : (urlRomaneio || d.fotos?.romaneio || ''),
      observacao: d.observacao || '',
      doca: d.doca || '',
      substatus: d.substatus || '',
      ocupacao: d.ocupacao || '',
      infrutifero: d.infrutifero || '',
      status: d.status || '',
      status1: d.status1 || ''
    };

    const { error } = await supabase
      .from('reports')
      .update(dadosAtualizados)
      .eq('protocolo', protocolo);

    if (error) throw new Error(error.message);

    return res.status(200).json({ ok: true, message: 'Report atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao editar report:', err.message);
    return res.status(500).json({ error: 'Falha ao atualizar report: ' + err.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, req, res, next) => res.status(500).json({ error: 'Erro interno no servidor.' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT} com leitura direta do Google Sheets`));