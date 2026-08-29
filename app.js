"use strict";

const STORAGE_KEY = "modern-todo-list";
const todoForm = document.querySelector("#todo-form");
const todoInput = document.querySelector("#todo-input");
const todoList = document.querySelector("#todo-list");
const todoCount = document.querySelector("#todo-count");
const emptyState = document.querySelector("#empty-state");
const emptyTitle = document.querySelector("#empty-title");
const emptyHint = document.querySelector("#empty-hint");
const filterButtons = document.querySelectorAll(".filter-button");
const clearCompletedButton = document.querySelector("#clear-completed");
const calendarToggle = document.querySelector("#calendar-toggle");
const calendarPanel = document.querySelector("#calendar-panel");
const calendarMonth = document.querySelector("#calendar-month");
const calendarGrid = document.querySelector("#calendar-grid");
const previousMonthButton = document.querySelector("#previous-month");
const nextMonthButton = document.querySelector("#next-month");
const selectedDateLabel = document.querySelector("#selected-date-label");
const listTitle = document.querySelector("#list-title");
const fullDate = document.querySelector("#full-date");
const todayButton = document.querySelector("#today-button");
const previousDayButton = document.querySelector("#previous-day");
const nextDayButton = document.querySelector("#next-day");

let selectedDate = toDateKey(new Date());
let todos = loadTodos();
let currentFilter = "all";
let visibleMonth = new Date(fromDateKey(selectedDate).getFullYear(), fromDateKey(selectedDate).getMonth(), 1);

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function loadTodos() {
  try {
    const savedTodos = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(savedTodos)) return [];
    let migrated = false;
    const normalizedTodos = savedTodos.map((todo) => {
      if (todo.date) return todo;
      migrated = true;
      return { ...todo, date: selectedDate };
    });
    if (migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedTodos));
    return normalizedTodos;
  } catch (error) {
    console.warn("无法读取已保存的待办事项：", error);
    return [];
  }
}

function saveTodos() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addTodo(text) {
  todos.unshift({ id: createId(), text, date: selectedDate, completed: false });
  saveTodos();
  renderTodos();
}

function toggleTodo(id) {
  todos = todos.map((todo) => todo.id === id ? { ...todo, completed: !todo.completed } : todo);
  saveTodos();
  renderTodos();
}

function deleteTodo(id) {
  todos = todos.filter((todo) => todo.id !== id);
  saveTodos();
  renderTodos();
}

function clearCompleted() {
  todos = todos.filter((todo) => todo.date !== selectedDate || !todo.completed);
  saveTodos();
  renderTodos();
}

function getDayTodos() {
  return todos.filter((todo) => todo.date === selectedDate);
}

function getVisibleTodos(dayTodos) {
  if (currentFilter === "active") return dayTodos.filter((todo) => !todo.completed);
  if (currentFilter === "completed") return dayTodos.filter((todo) => todo.completed);
  return dayTodos;
}

function getRelativeDayLabel(dateKey) {
  const date = fromDateKey(dateKey);
  const today = fromDateKey(toDateKey(new Date()));
  const difference = Math.round((date - today) / 86400000);
  if (difference === 0) return "今天";
  if (difference === 1) return "明天";
  if (difference === -1) return "昨天";
  return date > today ? "未来计划" : "往日记录";
}

function updateDateHeader() {
  const date = fromDateKey(selectedDate);
  const relativeLabel = getRelativeDayLabel(selectedDate);
  const formattedDate = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  }).format(date);
  selectedDateLabel.textContent = relativeLabel;
  listTitle.textContent = `${relativeLabel}的任务`;
  fullDate.textContent = formattedDate;
  todayButton.hidden = selectedDate === toDateKey(new Date());
  todoInput.placeholder = relativeLabel === "未来计划" ? "为这一天安排任务…" : "添加一项新任务…";
}

function changeSelectedDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
  selectedDate = dateKey;
  visibleMonth = new Date(fromDateKey(dateKey).getFullYear(), fromDateKey(dateKey).getMonth(), 1);
  renderTodos();
}

function renderCalendar() {
  calendarGrid.replaceChildren();
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toDateKey(new Date());
  const datesWithTodos = new Set(todos.map((todo) => todo.date));

  calendarMonth.textContent = `${year}年${month + 1}月`;

  for (let index = 0; index < firstDayOffset; index += 1) {
    const spacer = document.createElement("span");
    spacer.className = "calendar-spacer";
    spacer.setAttribute("aria-hidden", "true");
    calendarGrid.append(spacer);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = toDateKey(new Date(year, month, day));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.textContent = String(day);
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", `${year}年${month + 1}月${day}日`);
    button.classList.toggle("today", dateKey === todayKey);
    button.classList.toggle("selected", dateKey === selectedDate);
    button.classList.toggle("has-todos", datesWithTodos.has(dateKey));
    button.setAttribute("aria-selected", String(dateKey === selectedDate));
    button.addEventListener("click", () => {
      changeSelectedDate(dateKey);
      calendarPanel.hidden = true;
      calendarToggle.setAttribute("aria-expanded", "false");
      calendarToggle.focus();
    });
    calendarGrid.append(button);
  }
}

function shiftVisibleMonth(offset) {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
  renderCalendar();
}

function shiftSelectedDate(days) {
  const date = fromDateKey(selectedDate);
  date.setDate(date.getDate() + days);
  changeSelectedDate(toDateKey(date));
}

function renderTodos() {
  todoList.replaceChildren();
  updateDateHeader();
  const dayTodos = getDayTodos();
  const visibleTodos = getVisibleTodos(dayTodos);

  visibleTodos.forEach((todo) => {
    const item = document.createElement("li");
    item.className = `todo-item${todo.completed ? " completed" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "todo-checkbox";
    checkbox.checked = todo.completed;
    checkbox.setAttribute("aria-label", `标记“${todo.text}”为${todo.completed ? "未完成" : "已完成"}`);
    checkbox.addEventListener("change", () => toggleTodo(todo.id));
    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = todo.text;
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", `删除“${todo.text}”`);
    deleteButton.addEventListener("click", () => deleteTodo(todo.id));
    item.append(checkbox, text, deleteButton);
    todoList.append(item);
  });

  const remainingCount = dayTodos.filter((todo) => !todo.completed).length;
  todoCount.textContent = `${remainingCount} 项待完成`;
  emptyState.hidden = visibleTodos.length > 0;
  emptyTitle.textContent = currentFilter === "all" ? "这一天还没有待办" : "没有符合条件的待办";
  emptyHint.textContent = currentFilter === "all" ? "添加一项任务，开始行动吧" : "试试切换到其他筛选条件";
  clearCompletedButton.disabled = !dayTodos.some((todo) => todo.completed);
  renderCalendar();
}

todoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return todoInput.focus();
  addTodo(text);
  todoInput.value = "";
  todoInput.focus();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    filterButtons.forEach((filterButton) => {
      const isActive = filterButton === button;
      filterButton.classList.toggle("active", isActive);
      filterButton.setAttribute("aria-pressed", String(isActive));
    });
    renderTodos();
  });
});

calendarToggle.addEventListener("click", () => {
  calendarPanel.hidden = !calendarPanel.hidden;
  calendarToggle.setAttribute("aria-expanded", String(!calendarPanel.hidden));
  if (!calendarPanel.hidden) renderCalendar();
});
previousMonthButton.addEventListener("click", () => shiftVisibleMonth(-1));
nextMonthButton.addEventListener("click", () => shiftVisibleMonth(1));
previousDayButton.addEventListener("click", () => shiftSelectedDate(-1));
nextDayButton.addEventListener("click", () => shiftSelectedDate(1));
todayButton.addEventListener("click", () => changeSelectedDate(toDateKey(new Date())));
clearCompletedButton.addEventListener("click", clearCompleted);
renderTodos();
