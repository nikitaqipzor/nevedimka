process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/nevidimka_webtest";
import {
  getOrCreateUser, createMission, createMilestone, getOrCreateTodayPlan,
  saveCheckIn, createTask, setPlanAiSummary, addEvidence, updateTaskStatus,
  addIdea, addMentorMessage, createContentDraft, addContentVersion,
  setChosenVersion, setContentVersionPrivacyFlags,
} from "/home/claude/nevidimka/packages/db/dist/index.js";

async function main() {
  const user = await getOrCreateUser({ telegramId: "700111222", username: "webtest", firstName: "Никита" });
  console.log("user:", user.id);

  const mission = await createMission({
    userId: user.id, title: "Собрать личную операционную систему",
    description: "180 дней на дисциплину, продукт и форму.",
    directions: ["Создание", "Тело", "Смелость"],
    commitmentText: "Обещаю себе доводить начатое до конца, даже когда трудно и не хочется.",
  });
  await createMilestone({ userId: user.id, missionId: mission.id, title: "MVP готов", targetDay: 30 });
  await createMilestone({ userId: user.id, missionId: mission.id, title: "Первые пользователи", targetDay: 90 });
  await createMilestone({ userId: user.id, missionId: mission.id, title: "Стабильный ритм", targetDay: 150 });

  const today = new Date().toISOString().slice(0, 10);
  const plan = await getOrCreateTodayPlan(user.id, today, 12);
  await saveCheckIn(user.id, plan.id, { sleepQuality: 4, energy: 3, mood: 4, stress: 2 });
  await setPlanAiSummary(user.id, plan.id, "Никита, день 12 из 180. Вчера главная задача выполнена на 80%. Сегодня продолжаем — не начинаем ничего нового.");

  const mainTask = await createTask({
    userId: user.id, dailyPlanId: plan.id, missionId: mission.id,
    title: "Настроить CI и написать первый эндпоинт", isMainTask: true,
    estimateMinutes: 45, direction: "Создание",
  });
  const extraTask = await createTask({
    userId: user.id, dailyPlanId: plan.id, missionId: mission.id,
    title: "20 минут пробежки", isMainTask: false, estimateMinutes: 20, direction: "Тело",
  });
  await addEvidence({ userId: user.id, taskId: mainTask.id, kind: "text", rawText: "CI настроен, эндпоинт написан и покрыт тестом." });
  await updateTaskStatus(user.id, mainTask.id, "done", 100);
  await updateTaskStatus(user.id, extraTask.id, "postponed");

  // A second, older task (done) tagged "Смелость" so the skills map has all 3 directions with real numbers
  const oldPlan = await getOrCreateTodayPlan(user.id, "2026-07-14", 1);
  const oldTask = await createTask({
    userId: user.id, dailyPlanId: oldPlan.id, missionId: mission.id,
    title: "Записать первое публичное видео", isMainTask: true, estimateMinutes: 30, direction: "Смелость",
  });
  await updateTaskStatus(user.id, oldTask.id, "done", 100);

  await addIdea(user.id, "Добавить тёмную тему в Mini App");
  await addIdea(user.id, "Сделать экспорт дневника в PDF");

  await addMentorMessage({ userId: user.id, role: "user", content: "Как дела с прогрессом за неделю?" });
  await addMentorMessage({ userId: user.id, role: "assistant", content: "Ты выполнил главную задачу вчера на 80% — хороший темп. Продолжай в том же ритме." });

  const draft = await createContentDraft({ userId: user.id, sourceText: "CI настроен, эндпоинт написан и покрыт тестом." });
  await addContentVersion({ userId: user.id, draftId: draft.id, step: "original", text: draft.sourceText });
  const gentle = await addContentVersion({ userId: user.id, draftId: draft.id, step: "gentle", text: "Сегодня настроил CI и написал первый эндпоинт с тестами." });
  await addContentVersion({ userId: user.id, draftId: draft.id, step: "structured", text: "Итог дня:\n\nCI настроен, эндпоинт написан и покрыт тестом." });
  await addContentVersion({ userId: user.id, draftId: draft.id, step: "short", text: "CI и первый эндпоинт готовы." });

  console.log("draft (ready_for_review, not yet finalized):", draft.id);
  console.log("\nSEED COMPLETE");
}

main().catch((err) => { console.error("SEED FAILED:", err); process.exit(1); });
