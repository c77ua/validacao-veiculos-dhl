process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

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

// Configuração do Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xubxoiijtzowxwhdzjdo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('✅ Cliente Supabase inicializado com sucesso!');

// Função auxiliar para autenticar e ler o Google Sheets
async function lerPlanilhaGoogle() {
  try {
    let credentials = process.env.GOOGLE_CREDENTIALS;
    if (!credentials) {
      throw new Error("Variável GOOGLE_CREDENTIALS não encontrada no ambiente.");
    }
    
    // Se estiver em formato string JSON, faz o parse
    if (typeof credentials === 'string') {
      credentials = JSON.parse(credentials);
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // ID da planilha e aba que você utilizava no IMPORTRANGE
    const spreadsheetId = '17QG9zzVKdiSH7sXrnopO2kRVjILxwv8ijUeY7W4gRgM';
    const range = 'BRXSP1_ARENA!A1:AQ';

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    return response.data.values || [];
  } catch (err) {
    console.error("Erro ao ler planilha do Google:", err.message);
    throw err;
  }
}

// ===== ROTA DE SINCRONIZAÇÃO DO PÁTIO =====
app.get('/api/sincronizar-patio', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const linhas = await lerPlanilhaGoogle();
    if (linhas.length <= 1) {
      return res.status(200).json({ ok: true, message: 'Nenhum dado encontrado na planilha.' });
    }

    // Pula o cabeçalho (linha 0)
    const registros = [];
    for (let i = 1; i < linhas.length; i++) {
      const linha = linhas[i];
      if (!linha[0]) continue; // Se não tem protocolo, pula

      registros.push({
        protocolo: String(linha[0] || '').trim(),
        route_id: String(linha[2] || '').trim(), // Coluna 3 (index 2) conforme sua estrutura
        rota: String(linha[3] || '').trim(),
        data: String(linha[4] || '').trim(),
        transportadora: String(linha[5] || '').trim(),
        perfil_rosterizado: String(linha[6] || '').trim(),
        placa: String(linha[7] || '').trim(),
        placa_reboque: String(linha[8] || '').trim(),
        motorista: String(linha[9] || '').trim(),
        sigla_origem: String(linha[10] || '').trim(),
        origem: String(linha[11] || '').trim(),
        prazo_eta: String(linha[12] || '').trim(),
        prazo_cpt: String(linha[13] || '').trim(),
        destino: String(linha[14] || '').trim(),
        perfil_fisico: String(linha[15] || '').trim(),
        capacidade: String(linha[16] || '').trim(),
        hora_cpt: String(linha[18] || '').trim(),
        dh_chegada: String(linha[20] || '').trim(),
        dh_entrada: String(linha[25] || '').trim(),
        dh_doca: String(linha[26] || '').trim(),
        dh_saida_doca: String(linha[28] || '').trim(),
        doca: String(linha[29] || '').trim(),
        setor_aloca: String(linha[30] || '').trim(),
        status: 'PENDENTE'
      });
    }

    // Insere ou atualiza em lote no Supabase
    if (registros.length > 0) {
      const { error } = await supabase
        .from('patio_pendente')
        .upsert(registros, { onConflict: 'protocolo' });

      if (error) throw new Error(error.message);
    }

    return res.status(200).json({ 
      ok: true, 
      message: `Sincronizados ${registros.length} registos do Google Sheets para o Supabase com sucesso!` 
    });
  } catch (err) {
    console.error('Erro na sincronização:', err.message);
    return res.status(500).json({ error: 'Erro ao sincronizar pátio: ' + err.message });
  }
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
    const [{ data: rowsPatio, error: errPatio }, { data: rowsReports, error: errReports }] = await Promise.all([
      supabase.from('patio_pendente').select('*'),
      supabase.from('reports').select('protocolo')
    ]);

    if (errPatio) throw new Error(errPatio.message);
    if (errReports) throw new Error(errReports.message);

    const protocolosReportados = new Set();
    (rowsReports || []).forEach(r => {
      const proto = String(r.protocolo || '').trim();
      if (proto) protocolosReportados.add(proto);
    });

    const patio = (rowsPatio || [])
      .filter(r => {
        const protocolo = String(r.protocolo || '').trim();
        return protocolo !== '' && !protocolosReportados.has(protocolo);
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
    console.error('Erro ao carregar pátio:', err.message);
    return res.status(500).json({ error: 'Erro ao carregar pátio pendente.' });
  }
});

// 3. Rota dos Relatórios
app.get('/api/reports', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { data: rows, error } = await supabase.from('reports').select('*');
    if (error) throw new Error(error.message);

    const reports = (rows || []).map(r => ({
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
      status: r.status || '',
      horaLancamento: r.hora_lancamento || '',
      observacao: r.observacao || '',
      doca: r.doca || '',
      substatus: r.substatus || '',
      ocupacao: r.ocupacao || '',
      infrutifero: r.infrutifero || '',
      status1: r.status1 || ''
    }));

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
      status1: 'PENDENTE'
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
      infrutifero: d.infrutifero || ''
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
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT} com Supabase e Sincronização Google Sheets`));