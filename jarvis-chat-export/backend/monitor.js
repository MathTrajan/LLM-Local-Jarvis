const { getLastEventForAutomation } = require("./log-ingest-store");
const { getEnvInt } = require("./config");

// Brazil: UTC-3, sem horario de verao desde 2019
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000;
const OVERDUE_HOURS = getEnvInt("MONITOR_OVERDUE_HOURS", 5);

// Gera lista de horários a partir de um horário inicial com intervalo fixo
function intervalTimes(startTime, intervalMinutes, durationHours) {
  const times = [];
  const [h, m] = startTime.split(":").map(Number);
  const start = h * 60 + m;
  const end = start + durationHours * 60;
  for (let t = start; t <= end; t += intervalMinutes) {
    const hh = Math.floor(t / 60);
    const mm = t % 60;
    if (hh < 24) times.push(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  return times;
}

const AUTOMATIONS = [
  // --- AUTOMAÇÕES CONECTADAS ---
  // Programação de Pedidos: seg-sex 05:40, depois a cada 10 min por 12h
  { name: "Programacao_de_Pedidos",  displayName: "Programação de Pedidos",  connected: true,
    schedule: { type: "weekdays", times: intervalTimes("05:40", 10, 12) } },

  // Pedidos em Carga: seg-sex 05:50, depois a cada 30 min por 12h
  { name: "Pedidos_em_Carga",        displayName: "Pedidos em Carga",        connected: true,
    schedule: { type: "weekdays", times: intervalTimes("05:50", 30, 12) } },

  // Saldo Cotia: diário 12:00 e 17:00
  { name: "Saldo_Cotia",             displayName: "Saldo Cotia",             connected: true,
    schedule: { type: "daily",    times: ["12:00", "17:00"] } },

  // Acompanhamento e Meta: diário 07:30, 12:00, 15:30, 19:00
  { name: "Acompanhamento_e_Meta",   displayName: "Acompanhamento e Meta",   connected: true,
    schedule: { type: "daily",    times: ["07:30", "12:00", "15:30", "19:00"] } },

  // Curva A: mensal, dias 1, 10 e 20 às 00:00
  { name: "Curva_A",                 displayName: "Curva A",                 connected: true,
    schedule: { type: "monthly",  days: [1, 10, 20], times: ["00:00"] } },

  // Curva A 30 Dias: diário às 01:00
  { name: "Curva_A_30Dias",          displayName: "Curva A 30 Dias",         connected: true,
    schedule: { type: "daily",    times: ["01:00"] } },

  // Matriz Afiliados: seg, qua e sex às 02:00
  { name: "Matriz_Afiliados",        displayName: "Matriz Afiliados",        connected: true,
    schedule: { type: "specific_weekdays", weekdays: [1, 3, 5], times: ["02:00"] } },

  // Orçamento + Acompanhamento: seg-sex 06:10, 10:00, 13:00, 16:00
  { name: "Orcam_Acomp",             displayName: "Orçamento + Acompanhamento", connected: true,
    schedule: { type: "weekdays", times: ["06:10", "10:00", "13:00", "16:00"] } },

  // Estoque Analítico: seg-sex 06:20, depois a cada 1h por 12h
  { name: "Estoque_Analitico",       displayName: "Estoque Analítico",       connected: true,
    schedule: { type: "weekdays", times: intervalTimes("06:20", 60, 12) } },

  // Estoque Analítico EC: seg-sex 07:00 e 15:00
  { name: "atualizar-estoque-analitico", displayName: "Estoque Analítico EC", connected: true,
    schedule: { type: "weekdays", times: ["07:00", "15:00"] } },

  // Orçamento + Acompanhamento + Produto: seg-sex 06:10, 10:00, 13:00, 16:00
  { name: "Orcam_Acomp_Prod",        displayName: "Orçamento + Acomp. + Produto", connected: true,
    schedule: { type: "weekdays", times: ["06:10", "10:00", "13:00", "16:00"] } },

  // Reposição de Estoque: diário 07:00 e 14:00
  { name: "Reposicao_de_Estoque",    displayName: "Reposição de Estoque",    connected: true,
    schedule: { type: "daily",    times: ["07:00", "14:00"] } },

];

const DATA_SOURCES = [
  // Power BI Ecommerce: diário 07:30, 12:00, 15:30, 19:00
  { name: "PowerBI_Ecommerce",       displayName: "Power BI Ecommerce",      connected: true,
    schedule: { type: "daily",    times: ["07:30", "12:00", "15:30", "19:00"] } },
];

function toLocal(utcDate) {
  return new Date(utcDate.getTime() + TZ_OFFSET_MS);
}

function getLastExpectedRun(schedule, nowUtc) {
  const nowLocal = toLocal(nowUtc);
  const candidates = [];

  // Mensais: até 31 dias; dias específicos da semana: até 7 (ex: sex→seg); resto: 1
  const maxDaysBack = schedule.type === "monthly" ? 31 : schedule.type === "specific_weekdays" ? 7 : 1;

  for (let offset = 0; offset <= maxDaysBack; offset++) {
    const day = new Date(nowLocal);
    day.setDate(day.getDate() - offset);

    const dow = day.getDay();
    const dom = day.getDate();

    let runs = false;
    if (schedule.type === "daily")             runs = true;
    if (schedule.type === "weekdays")          runs = dow >= 1 && dow <= 5;
    if (schedule.type === "specific_weekdays") runs = (schedule.weekdays || []).includes(dow);
    if (schedule.type === "monthly")           runs = (schedule.days || []).includes(dom);
    if (!runs) continue;

    for (const timeStr of schedule.times) {
      const [h, m] = timeStr.split(":").map(Number);
      const scheduledLocal = new Date(day);
      scheduledLocal.setHours(h, m, 0, 0);
      const scheduledUtc = new Date(scheduledLocal.getTime() - TZ_OFFSET_MS);
      if (scheduledUtc <= nowUtc) candidates.push(scheduledUtc);
    }

    // Para mensais: achou o dia mais recente, não precisa continuar
    if (schedule.type === "monthly" && candidates.length > 0) break;
  }

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b - a)[0];
}

async function evaluateItems(items, nowUtc) {
  return Promise.all(
    items.map(async (auto) => {
      if (!auto.connected) {
        return { name: auto.name, displayName: auto.displayName, connected: false, status: "not_connected", lastExpectedRun: null, lastEventAt: null, hoursElapsed: null };
      }

      const lastExpectedUtc = getLastExpectedRun(auto.schedule, nowUtc);
      if (!lastExpectedUtc) {
        return { name: auto.name, displayName: auto.displayName, connected: true, status: "not_scheduled", lastExpectedRun: null, lastEventAt: null, hoursElapsed: null };
      }

      const hoursElapsed = (nowUtc - lastExpectedUtc) / (1000 * 60 * 60);
      const lastEvent = await getLastEventForAutomation(auto.name, lastExpectedUtc);

      let status;
      if (lastEvent)                          status = "ok";
      else if (hoursElapsed >= OVERDUE_HOURS) status = "overdue";
      else                                    status = "pending";

      return {
        name: auto.name,
        displayName: auto.displayName,
        connected: true,
        status,
        lastExpectedRun: lastExpectedUtc.toISOString(),
        lastEventAt: lastEvent?.timestamp || null,
        hoursElapsed: Number(hoursElapsed.toFixed(1)),
      };
    })
  );
}

async function getMonitorStatus() {
  const nowUtc = new Date();
  const [automations, dataSources] = await Promise.all([
    evaluateItems(AUTOMATIONS, nowUtc),
    evaluateItems(DATA_SOURCES, nowUtc),
  ]);

  const allItems = [...automations, ...dataSources];
  return {
    timestamp: nowUtc.toISOString(),
    overdueCount: allItems.filter((r) => r.status === "overdue").length,
    automations,
    dataSources,
  };
}

module.exports = { getMonitorStatus };
