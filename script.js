
(function () {
  'use strict';

  var STORAGE_KEY = 'organizador-financeiro-local-v1';
  var categories = [
    'Moradia', 'Contas da casa', 'Veículo', 'Educação',
    'Saúde', 'Comunicação', 'Alimentação', 'Transporte',
    'Parcela', 'Empréstimo', 'Assinatura', 'Cartão',
    'Despesa fixa', 'Outros'
  ];

  var state = loadState();
  var selectedWeek = '';
  var weekOffset = 0;
  var activeView = 'weekly';
  var analysisScope = 'all';
  var undoState = null;

  function emptyState() {
    return {
      version: 2,
      settings: {
        configured: false,
        openingBalance: 0,
        weeklyIncome: 0,
        firstIncomeDate: '',
        lastBackup: ''
      },
      weekOverrides: {},
      accounts: [],
      movements: [],
      cardPlans: [],
      history: []
    };
  }

  function normalize(data) {
    var base = emptyState();
    var value = data && typeof data === 'object' ? data : {};

    base.settings = Object.assign(base.settings, value.settings || {});
    base.weekOverrides = value.weekOverrides || {};
    base.accounts = Array.isArray(value.accounts) ? value.accounts : [];
    base.movements = Array.isArray(value.movements) ? value.movements : [];
    base.cardPlans = Array.isArray(value.cardPlans) ? value.cardPlans : [];
    base.history = Array.isArray(value.history) ? value.history : [];

    return base;
  }

  function loadState() {
    try {
      return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch (error) {
      return emptyState();
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function coreState(value) {
    return {
      version: 2,
      settings: value.settings,
      weekOverrides: value.weekOverrides,
      accounts: value.accounts,
      movements: value.movements,
      cardPlans: value.cardPlans
    };
  }

  function snapshot() {
    undoState = JSON.stringify(coreState(state));
  }

  function commit(message, details) {
    if (undoState) {
      state.history.unshift({
        id: uid(),
        createdAt: new Date().toISOString(),
        action: message,
        details: details || '',
        week: selectedWeek || '',
        before: undoState,
        undone: false
      });
      state.history = state.history.slice(0, 100);
    }

    undoState = null;
    persist();
    render();
    showUndo(message);
  }

  function latestUndoable() {
    return state.history.find(function (item) {
      return !item.undone && item.before;
    });
  }

  function undo(id) {
    var item = id
      ? state.history.find(function (entry) { return entry.id === id; })
      : latestUndoable();

    if (!item || item !== latestUndoable()) {
      toast('Desfaça primeiro a alteração mais recente.');
      return;
    }

    var history = state.history;
    state = normalize(JSON.parse(item.before));
    state.history = history;
    item.undone = true;
    undoState = null;
    persist();
    render();
    toast('Alteração desfeita.');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (c) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[c];
    });
  }

  function isoToday() {
    var d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }

  function parseDate(iso) {
    var p = String(iso || '').split('-').map(Number);
    return p.length === 3
      ? new Date(p[0], p[1] - 1, p[2], 12)
      : new Date();
  }

  function isoDate(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function addDays(iso, days) {
    var d = parseDate(iso);
    d.setDate(d.getDate() + days);
    return isoDate(d);
  }

  function addMonth(iso) {
    var d = parseDate(iso);
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);

    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));

    return isoDate(d);
  }

  function formatDate(iso) {
    if (!iso) return 'sem data';
    return parseDate(iso).toLocaleDateString('pt-BR');
  }

  function weekLabel(start) {
    var end = addDays(start, 6);
    var a = parseDate(start);
    var b = parseDate(end);

    return String(a.getDate()).padStart(2, '0') +
      (a.getMonth() === b.getMonth()
        ? ''
        : '/' + String(a.getMonth() + 1).padStart(2, '0')) +
      '-' +
      String(b.getDate()).padStart(2, '0') +
      '/' +
      String(b.getMonth() + 1).padStart(2, '0');
  }

  function weeks() {
    if (!state.settings.configured || !state.settings.firstIncomeDate) {
      return [];
    }

    var result = [];

    for (var i = 0; i < 30; i++) {
      var start = addDays(state.settings.firstIncomeDate, i * 7);
      var override = state.weekOverrides[start] || {};

      result.push({
        start: start,
        end: addDays(start, 6),
        label: weekLabel(start),
        income: Number(
          Object.prototype.hasOwnProperty.call(override, 'income')
            ? override.income
            : state.settings.weeklyIncome
        ),
        free: Number(override.free || 0)
      });
    }

    return calculateWeeks(result);
  }

  function weekForDate(date) {
    var list = weeks();

    for (var i = 0; i < list.length; i++) {
      if (date >= list[i].start && date <= list[i].end) {
        return list[i].start;
      }
    }

    return list.length ? list[list.length - 1].start : '';
  }

  function weekAccounts(start) {
    return state.accounts.filter(function (a) {
      return a.week === start && a.category !== 'Cartão';
    });
  }

  function weekMovements(start) {
    return state.movements.filter(function (m) {
      return m.week === start;
    });
  }

  function calculateWeeks(list) {
    var running = Number(state.settings.openingBalance || 0);

    return list.map(function (w) {
      var accounts = weekAccounts(w.start);
      var moves = weekMovements(w.start);

      var plannedCard = state.cardPlans
        .filter(function (p) {
          return p.week === w.start;
        })
        .reduce(function (n, p) {
          return n + Number(p.amount || 0);
        }, 0);

      var actualCard = moves
        .filter(function (m) {
          return m.type === 'cardPayment';
        })
        .reduce(function (n, m) {
          return n + Number(m.amount || 0);
        }, 0);

      var bills = accounts.reduce(function (n, a) {
        return n + Number(a.amount || 0);
      }, 0) + (actualCard > 0 ? actualCard : plannedCard);

      var extra = moves
        .filter(function (m) {
          return m.type === 'income';
        })
        .reduce(function (n, m) {
          return n + Number(m.amount || 0);
        }, 0);

      var spent = moves
        .filter(function (m) {
          return m.type === 'expense' || m.type === 'saving';
        })
        .reduce(function (n, m) {
          return n + Number(m.amount || 0);
        }, 0);

      var opening = running;
      var projected = opening + w.income + extra - bills - spent - w.free;
      running = projected;

      return Object.assign({}, w, {
        opening: opening,
        bills: bills,
        extra: extra,
        spent: spent,
        plannedCard: plannedCard,
        actualCard: actualCard,
        projected: projected,
        accounts: accounts,
        movements: moves
      });
    });
  }

  function currentWeek() {
    var list = weeks();
    var today = isoToday();
    var found = list.find(function (w) {
      return today >= w.start && today <= w.end;
    });

    return found ? found.start : (list[0] && list[0].start) || '';
  }

  function selected() {
    return weeks().find(function (w) {
      return w.start === selectedWeek;
    });
  }

  function cardTotal() {
    return state.accounts
      .filter(function (a) {
        return a.category === 'Cartão';
      })
      .reduce(function (n, a) {
        return n + Number(a.amount || 0);
      }, 0);
  }

  function cardPaid() {
    return state.movements
      .filter(function (m) {
        return m.type === 'cardPayment';
      })
      .reduce(function (n, m) {
        return n + Number(m.amount || 0);
      }, 0);
  }

  function cardRemaining() {
    return Math.max(0, cardTotal() - cardPaid());
  }

  function metric(label, value, kind) {
    return '<article class="metric ' + kind + '">' +
      '<div class="metric-label">' + esc(label) + '</div>' +
      '<div class="metric-value">' + money(value) + '</div>' +
      '</article>';
  }

  function render() {
    var list = weeks();

    if (!selectedWeek && list.length) {
      selectedWeek = currentWeek() || list[0].start;
    }

    if (selectedWeek && !list.some(function (w) {
      return w.start === selectedWeek;
    })) {
      selectedWeek = list[0] ? list[0].start : '';
    }

    document.getElementById('setupBanner').hidden = state.settings.configured;

    renderMetrics(list);
    renderWeekTabs(list);
    renderAccounts();
    renderCard();
    renderHistory();
    renderAnalysis();
    selectView(activeView);
  }

  function renderMetrics(list) {
    var start = Math.max(0, list.findIndex(function (w) {
      return w.start === selectedWeek;
    }));

    var month = list.slice(start, start + 4);

    var income = month.reduce(function (n, w) {
      return n + w.income + w.extra;
    }, 0);

    var bills = month.reduce(function (n, w) {
      return n + w.bills;
    }, 0);

    var saved = state.movements
      .filter(function (m) {
        return m.type === 'saving';
      })
      .reduce(function (n, m) {
        return n + Number(m.amount || 0);
      }, 0);

    var final = month.length
      ? month[month.length - 1].projected
      : Number(state.settings.openingBalance || 0);

    document.getElementById('metrics').innerHTML =
      metric('Recebimentos nas próximas 4 semanas', income, 'income') +
      metric('Contas nas próximas 4 semanas', bills, 'expense') +
      metric('Economia guardada', saved, 'income') +
      metric('Saldo projetado', final, 'balance');
  }

  function visibleWeekCount() {
    return window.innerWidth <= 470
      ? 2
      : window.innerWidth <= 760
        ? 3
        : 5;
  }

  function renderWeekTabs(list) {
    var root = document.getElementById('weekTabs');
    root.replaceChildren();

    if (!list.length) {
      root.innerHTML = '<div class="empty">Configure o organizador para criar as semanas.</div>';
      document.getElementById('weekDetail').innerHTML = '';
      return;
    }

    var count = visibleWeekCount();

    var selectedIndex = Math.max(0, list.findIndex(function (w) {
      return w.start === selectedWeek;
    }));

    if (selectedIndex < weekOffset) {
      weekOffset = selectedIndex;
    }

    if (selectedIndex >= weekOffset + count) {
      weekOffset = selectedIndex - count + 1;
    }

    weekOffset = Math.max(
      0,
      Math.min(weekOffset, Math.max(0, list.length - count))
    );

    var left = document.createElement('button');
    left.className = 'week-arrow';
    left.type = 'button';
    left.textContent = '<';
    left.disabled = weekOffset === 0;

    left.onclick = function () {
      weekOffset = Math.max(0, weekOffset - 1);
      renderWeekTabs(weeks());
    };

    var windowEl = document.createElement('div');
    windowEl.className = 'week-window';

    list.slice(weekOffset, weekOffset + count).forEach(function (w) {
      var b = document.createElement('button');
      b.className = 'period' + (w.start === selectedWeek ? ' active' : '');
      b.type = 'button';
      b.textContent = w.label;

      b.onclick = function () {
        selectedWeek = w.start;
        render();
      };

      windowEl.appendChild(b);
    });

    var right = document.createElement('button');
    right.className = 'week-arrow';
    right.type = 'button';
    right.textContent = '>';
    right.disabled = weekOffset + count >= list.length;

    right.onclick = function () {
      weekOffset = Math.min(list.length - count, weekOffset + 1);
      renderWeekTabs(weeks());
    };

    root.append(left, windowEl, right);

    renderWeekDetail(list.find(function (w) {
      return w.start === selectedWeek;
    }));
  }

  function renderWeekDetail(w) {
    if (!w) return;

    var lines = w.accounts.map(function (a) {
      return '<li class="week-bill">' +
        '<span>' + esc(a.title) + ' · ' + money(a.amount) + '</span>' +
        '<span class="inline-actions">' +
        '<button class="mini-button" data-edit-account="' + a.id + '">Editar/mover</button>' +
        '<button class="mini-button danger" data-delete-account="' + a.id + '">Excluir</button>' +
        '</span></li>';
    });

    if (w.plannedCard > 0) {
      lines.push(
        '<li class="week-bill">' +
        '<span>Pagamento planejado da fatura · ' + money(w.plannedCard) + '</span>' +
        '<button class="mini-button" data-view-card>Ver fatura</button>' +
        '</li>'
      );
    }

    if (!lines.length) {
      lines.push('<li>Nenhuma conta prevista nesta semana.</li>');
    }

    var future = weeks().slice(
      Math.max(0, weeks().findIndex(function (x) {
        return x.start === w.start;
      }))
    );

    var room = future.length
      ? Math.min.apply(null, future.map(function (x) {
          return x.projected - 200;
        }))
      : 0;

    var suggestion = Math.max(0, Math.min(100, Math.floor(room)));

    document.getElementById('weekDetail').innerHTML =
      '<div class="week-summary">' +
        '<div class="week-stat">' +
          '<span>Saldo anterior + entradas</span>' +
          '<strong>' + money(w.opening + w.income + w.extra) + '</strong>' +
        '</div>' +
        '<div class="week-stat">' +
          '<span>Total previsto nesta semana</span>' +
          '<strong>' + money(w.bills) + '</strong>' +
        '</div>' +
        '<div class="week-stat">' +
          '<span>Gastos e economia registrados</span>' +
          '<strong>' + money(w.spent) + '</strong>' +
        '</div>' +
        '<div class="week-stat ' + (w.projected < 0 ? 'warn' : 'good') + '">' +
          '<span>Sobra projetada</span>' +
          '<strong>' + money(w.projected) + '</strong>' +
        '</div>' +
      '</div>' +
      '<div class="guidance">' +
        '<h3>Contas da semana</h3>' +
        '<ul>' + lines.join('') + '</ul>' +
      '</div>' +
      (suggestion > 0
        ? '<div class="suggestion">' +
            '<h3>Você pode guardar até ' + money(suggestion) + '</h3>' +
            '<p>A projeção mantém pelo menos R$ 200 nas semanas seguintes.</p>' +
          '</div>'
        : '');

    bindAccountActions(document.getElementById('weekDetail'));
    appendWeekMovements(w);

    var cardLink = document.querySelector('[data-view-card]');

    if (cardLink) {
      cardLink.onclick = function () {
        selectView('card');
      };
    }
  }

  function renderAccounts() {
    var root = document.getElementById('entryList');

    var pending = state.accounts.filter(function (a) {
      return a.status !== 'paid';
    });

    var paid = state.accounts.filter(function (a) {
      return a.status === 'paid';
    });

    function card(a, history) {
      return '<article class="entry">' +
        '<div>' +
          '<div class="entry-title">' + esc(a.title) + '</div>' +
          '<div class="entry-meta">' +
            esc(a.category) +
            ' · Vence ' + formatDate(a.dueDate) +
            ' · Semana ' + esc(weekLabel(a.week)) +
            (a.recurring ? ' · Mensal' : '') +
          '</div>' +
          '<span class="pill ' + (history ? 'paid' : '') + '">' +
            (history ? 'Pago' : 'Pendente') +
          '</span>' +
        '</div>' +
        '<div class="entry-amount">' + money(a.amount) + '</div>' +
        '<div class="entry-actions">' +
          (!history && a.category !== 'Cartão'
            ? '<button class="mini-button" data-pay-account="' + a.id + '">Marcar pago</button>'
            : '') +
          (!history
            ? '<button class="mini-button" data-edit-account="' + a.id + '">Editar</button>' +
              '<button class="mini-button danger" data-delete-account="' + a.id + '">Excluir</button>'
            : '') +
        '</div>' +
      '</article>';
    }

    root.innerHTML =
      (pending.length
        ? pending.map(function (a) {
            return card(a, false);
          }).join('')
        : '<div class="empty"><strong>Nenhuma conta cadastrada.</strong>' +
          '<br>Comece por aluguel, energia, parcela do carro ou outra despesa fixa.</div>') +
      '<section class="history">' +
        '<h3>Histórico de contas pagas</h3>' +
        (paid.length
          ? paid.map(function (a) {
              return card(a, true);
            }).join('')
          : '<div class="empty">Ainda não há pagamentos registrados.</div>') +
      '</section>';

    bindAccountActions(root);
  }

  function bindAccountActions(root) {
    root.querySelectorAll('[data-edit-account]').forEach(function (b) {
      b.onclick = function () {
        openAccount(state.accounts.find(function (a) {
          return a.id === b.dataset.editAccount;
        }));
      };
    });

    root.querySelectorAll('[data-delete-account]').forEach(function (b) {
      b.onclick = function () {
        deleteAccount(b.dataset.deleteAccount);
      };
    });

    root.querySelectorAll('[data-pay-account]').forEach(function (b) {
      b.onclick = function () {
        markAccountPaid(b.dataset.payAccount);
      };
    });
  }

  function renderCard() {
    var total = cardTotal();
    var paid = cardPaid();
    var remaining = cardRemaining();

    document.getElementById('cardDebt').innerHTML =
      '<div>' +
        '<strong>Fatura cadastrada: ' + money(total) + '</strong>' +
        '<p>Pagamentos registrados: ' + money(paid) + '</p>' +
      '</div>' +
      '<div class="debt-numbers">' +
        '<span>Falta pagar</span>' +
        '<b>' + money(remaining) + '</b>' +
      '</div>';

    var plans = state.cardPlans.slice().sort(function (a, b) {
      return a.week.localeCompare(b.week);
    });

    document.getElementById('cardPlans').innerHTML =
      '<h3>Plano de pagamento</h3>' +
      (plans.length
        ? plans.map(function (p) {
            return '<article class="entry">' +
              '<div>' +
                '<div class="entry-title">Semana ' + esc(weekLabel(p.week)) + '</div>' +
                '<div class="entry-meta">Previsão; ainda não foi pago</div>' +
              '</div>' +
              '<div class="entry-amount">' + money(p.amount) + '</div>' +
              '<div class="entry-actions">' +
                '<button class="mini-button danger" data-delete-plan="' + p.id + '">Excluir</button>' +
              '</div>' +
            '</article>';
          }).join('')
        : '<div class="empty">Nenhum pagamento planejado.</div>');

    document.querySelectorAll('[data-delete-plan]').forEach(function (b) {
      b.onclick = function () {
        snapshot();
        state.cardPlans = state.cardPlans.filter(function (p) {
          return p.id !== b.dataset.deletePlan;
        });
        commit('Planejamento removido.');
      };
    });
  }

  function movementLabel(type) {
    return { expense: 'Gasto', income: 'Recebimento extra', cardPayment: 'Pagamento da fatura', saving: 'Dinheiro guardado' }[type] || 'Movimentação';
  }

  function movementDirection(type) {
    return type === 'income' ? 'income' : 'expense';
  }

  function movementCard(movement) {
    var sign = movement.type === 'income' ? '+' : '−';
    return '<article class="history-row"><div><div class="entry-title">' + esc(movement.description) + '</div><div class="entry-meta">' + esc(movementLabel(movement.type)) + ' · ' + formatDate(movement.date) + ' · Semana ' + esc(weekLabel(movement.week)) + '</div><div class="entry-actions"><button class="mini-button" data-edit-movement="' + movement.id + '">Editar</button><button class="mini-button danger" data-delete-movement="' + movement.id + '">Excluir</button></div></div><div class="history-value ' + movementDirection(movement.type) + '">' + sign + ' ' + money(movement.amount) + '</div></article>';
  }

  function appendWeekMovements(w) {
    var root = document.getElementById('weekDetail');
    var items = w.movements.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var section = document.createElement('section');
    section.className = 'movement-history';
    section.innerHTML = '<div class="history-heading"><h3>Movimentações da semana</h3></div>' + (items.length ? items.map(movementCard).join('') : '<div class="empty">Nenhum gasto, entrada ou economia lançado nesta semana.</div>');
    root.appendChild(section);
    bindMovementActions(section);
  }

  function bindMovementActions(root) {
    root.querySelectorAll('[data-edit-movement]').forEach(function (button) {
      button.onclick = function () {
        openMovement(state.movements.find(function (movement) { return movement.id === button.dataset.editMovement; }));
      };
    });
    root.querySelectorAll('[data-delete-movement]').forEach(function (button) {
      button.onclick = function () { deleteMovement(button.dataset.deleteMovement); };
    });
  }

  function deleteMovement(id) {
    var movement = state.movements.find(function (item) { return item.id === id; });
    if (!movement || !confirm('Excluir ' + movement.description + '?')) return;
    snapshot();
    state.movements = state.movements.filter(function (item) { return item.id !== id; });
    commit('Movimentação excluída.', movement.description + ' · ' + money(movement.amount));
  }

  function renderHistory() {
    var root = document.getElementById('historyContent');
    var movements = state.movements.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var paidAccounts = state.accounts.filter(function (account) { return account.status === 'paid'; }).sort(function (a, b) { return String(b.paidDate).localeCompare(String(a.paidDate)); });
    var latest = latestUndoable();
    var records = movements.map(movementCard).join('') + paidAccounts.map(function (account) {
      return '<article class="history-row"><div><div class="entry-title">' + esc(account.title) + '</div><div class="entry-meta">Conta paga · ' + formatDate(account.paidDate) + ' · Vencimento ' + formatDate(account.dueDate) + '</div></div><div class="history-value expense">− ' + money(account.amount) + '</div></article>';
    }).join('');
    var actions = state.history.map(function (item) {
      return '<article class="history-row ' + (item.undone ? 'undone' : '') + '"><div><div class="entry-title">' + esc(item.action) + '</div><div class="entry-meta">' + new Date(item.createdAt).toLocaleString('pt-BR') + (item.details ? ' · ' + esc(item.details) : '') + (item.undone ? ' · Desfeita' : '') + '</div></div>' + (latest && latest.id === item.id ? '<button class="mini-button" data-undo-history="' + item.id + '">Desfazer</button>' : '') + '</article>';
    }).join('');
    root.innerHTML = '<section><div class="history-heading"><h3>Entradas e saídas registradas</h3></div>' + (records || '<div class="empty">Nenhuma movimentação ou conta paga registrada.</div>') + '</section><section class="activity-history"><div class="history-heading"><h3>Alterações realizadas</h3></div>' + (actions || '<div class="empty">As próximas alterações feitas no organizador aparecerão aqui.</div>') + '</section>';
    bindMovementActions(root);
    root.querySelectorAll('[data-undo-history]').forEach(function (button) {
      button.onclick = function () { undo(button.dataset.undoHistory); };
    });
  }

  function renderAnalysis() {
    var root = document.getElementById('analysisContent');
    var list = weeks();

    var start = Math.max(0, list.findIndex(function (w) {
      return w.start === selectedWeek;
    }));

    var shown = analysisScope === 'week'
      ? list.slice(start, start + 1)
      : list.slice(start);

    document.getElementById('analysisTitle').textContent =
      analysisScope === 'week'
        ? 'Análise da semana'
        : 'Análise detalhada';

    root.innerHTML = shown.length
      ? shown.map(function (w) {
          var bills = w.accounts.map(function (a) {
            return a.title + ' ' + money(a.amount);
          });

          if (w.plannedCard) {
            bills.push('Fatura planejada ' + money(w.plannedCard));
          }

          return '<article class="analysis-row ' +
            (w.projected < 0 ? 'danger' : '') + '">' +
            '<div>' +
              '<strong>Semana ' + esc(w.label) + '</strong>' +
              '<small>Começa com ' + money(w.opening) +
                ' · recebe ' + money(w.income + w.extra) +
                ' · paga ' + money(w.bills) +
                ' · gastos/economia ' + money(w.spent) +
                ' · reserva livre ' + money(w.free) +
              '</small>' +
              '<small>' +
                (bills.length
                  ? 'Contas: ' + esc(bills.join(' · '))
                  : 'Sem contas previstas') +
              '</small>' +
            '</div>' +
            '<div>' +
              '<small>Termina com</small>' +
              '<strong>' + money(w.projected) + '</strong>' +
            '</div>' +
          '</article>';
        }).join('')
      : '<div class="empty">Configure o organizador para visualizar a análise.</div>';
  }

  function selectView(view) {
    activeView = view;

    document.getElementById('weekPanel').hidden = view !== 'weekly';
    document.getElementById('accountPanel').hidden = view !== 'accounts';
    document.getElementById('cardPanel').hidden = view !== 'card';
    document.getElementById('historyPanel').hidden = view !== 'history';
    document.getElementById('analysisPanel').hidden = view !== 'analysis';

    var highlighted = view === 'analysis' && analysisScope === 'week'
      ? 'weekly'
      : view;

    document.querySelectorAll('.view-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === highlighted);
    });

    if (view === 'analysis') renderAnalysis();
  }

  function fillWeekSelect(select, value) {
    var list = weeks();

    select.innerHTML = list.map(function (w) {
      return '<option value="' + w.start + '">' +
        esc(w.label) +
        '</option>';
    }).join('');

    select.value = value || selectedWeek || (list[0] && list[0].start) || '';
  }

  function openAccount(account) {
    if (!state.settings.configured) {
      openSetup();
      return;
    }

    var select = document.getElementById('accountCategory');

    select.innerHTML = categories.map(function (c) {
      return '<option>' + esc(c) + '</option>';
    }).join('');

    document.getElementById('accountId').value = account ? account.id : '';
    document.getElementById('accountDialogTitle').textContent =
      account ? 'Editar conta' : 'Adicionar conta';

    document.getElementById('accountTitle').value =
      account ? account.title : '';

    document.getElementById('accountAmount').value =
      account ? account.amount : '';

    select.value = account ? account.category : 'Moradia';

    document.getElementById('accountDue').value =
      account ? account.dueDate : isoToday();

    fillWeekSelect(
      document.getElementById('accountWeek'),
      account ? account.week : selectedWeek
    );

    document.getElementById('accountRecurring').checked =
      !!(account && account.recurring);

    document.getElementById('accountDialog').showModal();
  }

  function saveAccount(event) {
    event.preventDefault();

    var id = document.getElementById('accountId').value;

    var existing = state.accounts.find(function (a) {
      return a.id === id;
    });

    var account = {
      id: id || uid(),
      title: document.getElementById('accountTitle').value.trim(),
      amount: Number(document.getElementById('accountAmount').value),
      category: document.getElementById('accountCategory').value,
      dueDate: document.getElementById('accountDue').value,
      week: document.getElementById('accountWeek').value,
      recurring: document.getElementById('accountRecurring').checked,
      status: existing ? existing.status : 'pending',
      paidDate: existing ? existing.paidDate : ''
    };

    snapshot();

    if (existing) {
      state.accounts[state.accounts.indexOf(existing)] = account;
    } else {
      state.accounts.push(account);
    }

    document.getElementById('accountDialog').close();
    selectedWeek = account.week;

    commit(existing
      ? 'Conta atualizada e semanas recalculadas.'
      : 'Conta adicionada e semanas recalculadas.');
  }

  function deleteAccount(id) {
    var account = state.accounts.find(function (a) {
      return a.id === id;
    });

    if (!account || !confirm('Excluir ' + account.title + '?')) return;

    snapshot();

    state.accounts = state.accounts.filter(function (a) {
      return a.id !== id;
    });

    commit('Conta excluída.');
  }

  function markAccountPaid(id) {
    var account = state.accounts.find(function (a) {
      return a.id === id;
    });

    if (!account || !confirm('Confirmar o pagamento de ' + account.title + '?')) {
      return;
    }

    snapshot();

    account.status = 'paid';
    account.paidDate = isoToday();

    if (account.recurring) {
      var nextDue = addMonth(account.dueDate);

      state.accounts.push(Object.assign({}, account, {
        id: uid(),
        dueDate: nextDue,
        week: weekForDate(nextDue),
        status: 'pending',
        paidDate: ''
      }));
    }

    commit('Pagamento registrado.');
  }

  function openMovement(value) {
    if (!state.settings.configured) {
      openSetup();
      return;
    }

    var movement = value && typeof value === 'object' ? value : null;
    var type = movement ? movement.type : (value || 'expense');

    document.getElementById('movementId').value = movement ? movement.id : '';
    document.getElementById('movementType').value = type;
    document.getElementById('movementDescription').value = movement
      ? movement.description
      : (type === 'cardPayment' ? 'Pagamento da fatura' : '');
    document.getElementById('movementAmount').value = movement ? movement.amount : '';
    document.getElementById('movementDate').value = movement ? movement.date : isoToday();

    fillWeekSelect(document.getElementById('movementWeek'), movement ? movement.week : selectedWeek);
    document.getElementById('movementDialog').showModal();
  }

  function saveMovement(event) {
    event.preventDefault();

    var id = document.getElementById('movementId').value;
    var existing = state.movements.find(function (movement) {
      return movement.id === id;
    });

    var movement = {
      id: id || uid(),
      type: document.getElementById('movementType').value,
      description: document.getElementById('movementDescription').value.trim(),
      amount: Number(document.getElementById('movementAmount').value),
      date: document.getElementById('movementDate').value,
      week: document.getElementById('movementWeek').value,
      createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    snapshot();

    if (existing) {
      state.movements[state.movements.indexOf(existing)] = movement;
    } else {
      state.movements.push(movement);
    }

    selectedWeek = movement.week;
    document.getElementById('movementDialog').close();
    commit(existing ? 'Movimentação atualizada.' : 'Movimentação registrada.', movement.description + ' · ' + money(movement.amount));
  }

  function openWeek() {
    var w = selected();

    if (!w) {
      openSetup();
      return;
    }

    document.getElementById('weekDialogText').textContent =
      'Semana ' + w.label +
      '. Edite apenas a previsão; valores que já aconteceram entram em Lançar movimentação.';

    document.getElementById('weekIncome').value = w.income;
    document.getElementById('weekFree').value = w.free;
    document.getElementById('weekDialog').showModal();
  }

  function saveWeek(event) {
    event.preventDefault();
    snapshot();

    state.weekOverrides[selectedWeek] = {
      income: Number(document.getElementById('weekIncome').value),
      free: Number(document.getElementById('weekFree').value)
    };

    document.getElementById('weekDialog').close();
    commit('Previsão atualizada.');
  }

  function openCardPlan() {
    if (!state.settings.configured) {
      openSetup();
      return;
    }

    fillWeekSelect(document.getElementById('cardPlanWeek'), selectedWeek);
    document.getElementById('cardPlanAmount').value = '';
    document.getElementById('cardPlanDialog').showModal();
  }

  function saveCardPlan(event) {
    event.preventDefault();
    snapshot();

    state.cardPlans.push({
      id: uid(),
      week: document.getElementById('cardPlanWeek').value,
      amount: Number(document.getElementById('cardPlanAmount').value)
    });

    document.getElementById('cardPlanDialog').close();
    commit('Pagamento incluído no planejamento.');
  }

  function openSetup() {
    document.getElementById('openingBalance').value =
      state.settings.openingBalance || 0;

    document.getElementById('weeklyIncome').value =
      state.settings.weeklyIncome || 0;

    document.getElementById('firstIncomeDate').value =
      state.settings.firstIncomeDate || isoToday();

    document.getElementById('setupDialog').showModal();
  }

  function saveSetup(event) {
    event.preventDefault();
    snapshot();

    state.settings.configured = true;

    state.settings.openingBalance =
      Number(document.getElementById('openingBalance').value);

    state.settings.weeklyIncome =
      Number(document.getElementById('weeklyIncome').value);

    state.settings.firstIncomeDate =
      document.getElementById('firstIncomeDate').value;

    selectedWeek = state.settings.firstIncomeDate;

    document.getElementById('setupDialog').close();
    commit('Configuração salva.');
  }

  function exportBackup() {
    state.settings.lastBackup = new Date().toISOString();
    persist();

    var blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json'
    });

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');

    a.href = url;
    a.download = 'backup-organizador-' + isoToday() + '.json';
    a.click();

    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    toast('Backup baixado neste aparelho.');
  }

  function importBackup(file) {
    if (!file) return;

    var reader = new FileReader();

    reader.onload = function () {
      try {
        var imported = normalize(JSON.parse(reader.result));

        if (!imported.settings || !Array.isArray(imported.accounts)) {
          throw new Error();
        }

        snapshot();
        state = imported;
        persist();
        selectedWeek = '';
        render();
        showUndo('Backup importado.');
      } catch (error) {
        toast('Esse arquivo não é um backup válido.');
      }
    };

    reader.readAsText(file);
  }

  function toast(message) {
    var root = document.getElementById('toast');
    root.textContent = message;
    root.classList.add('show');

    clearTimeout(toast.timer);

    toast.timer = setTimeout(function () {
      root.classList.remove('show');
    }, 3000);
  }

  function showUndo(message) {
    var root = document.getElementById('toast');

    root.innerHTML =
      '<span>' + esc(message) + '</span> ' +
      '<button class="mini-button" id="undoButton" type="button">Desfazer</button>';

    root.classList.add('show');

    document.getElementById('undoButton').onclick = undo;

    clearTimeout(toast.timer);

    toast.timer = setTimeout(function () {
      root.classList.remove('show');
      undoState = null;
    }, 6500);
  }

  document.querySelectorAll('.view-tab').forEach(function (b) {
    b.onclick = function () {
      if (b.dataset.view === 'analysis') {
        analysisScope = 'all';
      }
      selectView(b.dataset.view);
    };
  });

  document.querySelectorAll('[data-close-dialog]').forEach(function (b) {
    b.onclick = function () {
      document.getElementById(b.dataset.closeDialog).close();
    };
  });

  document.getElementById('setupButton').onclick = openSetup;
  document.getElementById('settingsButton').onclick = openSetup;

  document.getElementById('addButton').onclick = function () {
    openAccount(null);
  };

  document.getElementById('addWeekBillButton').onclick = function () {
    openAccount(null);
  };

  document.getElementById('recordButton').onclick = function () {
    openMovement('expense');
  };

  document.getElementById('editWeekButton').onclick = openWeek;

  document.getElementById('analysisButton').onclick = function () {
    analysisScope = 'week';
    selectView('analysis');
  };

  document.getElementById('planCardButton').onclick = openCardPlan;

  document.getElementById('payCardButton').onclick = function () {
    openMovement('cardPayment');
  };

  document.getElementById('backupButton').onclick = exportBackup;

  document.getElementById('importInput').onchange = function () {
    importBackup(this.files[0]);
    this.value = '';
  };

  document.getElementById('setupForm').onsubmit = saveSetup;
  document.getElementById('accountForm').onsubmit = saveAccount;
  document.getElementById('movementForm').onsubmit = saveMovement;
  document.getElementById('weekForm').onsubmit = saveWeek;
  document.getElementById('cardPlanForm').onsubmit = saveCardPlan;

  window.addEventListener('resize', function () {
    renderWeekTabs(weeks());
  });

  render();

  if (!state.settings.configured) {
    setTimeout(openSetup, 250);
  }
})();
