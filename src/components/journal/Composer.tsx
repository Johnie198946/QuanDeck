import { useEffect, useRef, useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";

/** 底部安静输入：回车记录。TODO 模式或以 “[] ” 开头即创建待办；末尾 “15m” 识别为预计时长。 */
export function Composer() {
  const { api, toast, openWorkspace } = useWorkdeck();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 演示菜单可预填一句想法
  useEffect(() => {
    const fill = (e: Event) => {
      setValue((e as CustomEvent<string>).detail);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("quandeck:prefill", fill);
    return () => window.removeEventListener("quandeck:prefill", fill);
  }, []);

  /** 复杂想法：准备交给 Agent 讨论；只保存事项，不派发或本地模拟回复 */
  const think = async () => {
    const raw = value.trim();
    if (!raw || busy) return;
    setBusy(true);
    try {
      const { taskId } = await api.createIdea(raw);
      setValue("");
      openWorkspace(taskId, { view: "plan", pane: "side" });
    } catch {
      toast("未能保存想法，内容已保留，请重试。", "error");
    } finally {
      setBusy(false);
    }
  };
  const [todo, setTodo] = useState(true);

  const submit = async () => {
    const raw = value.trim();
    if (!raw || busy) return;
    const isTodo = todo || /^(\[\s?\]|-\s\[\s?\])\s*/.test(raw);
    const text = raw.replace(/^(\[\s?\]|-\s\[\s?\])\s*/, "");
    setBusy(true);
    try {
      await api.addBlock(isTodo ? "task" : "text", text);
      setValue("");
      toast(isTodo ? "已记为待办" : "已记入日记");
    } catch {
      toast("未能保存，内容已保留，请重试。", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="qd-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <button
        type="button"
        className={`qd-mode ${todo ? "is-todo" : ""}`}
        onClick={() => setTodo((v) => !v)}
        aria-pressed={todo}
        title={todo ? "当前：创建 TODO（点击切换为文字）" : "当前：记录文字（点击切换为 TODO）"}
      >
        <Icon name={todo ? "check-square" : "pencil"} size={17} />
        <span>{todo ? "待办" : "文字"}</span>
      </button>
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (!e.nativeEvent.isComposing && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            think();
          }
        }}
        placeholder={todo ? "添加任务，例如：整理旅行攻略" : "记下想法，或交给 Agent 讨论…"}
        aria-label="记录想法或输入任务"
      />
        <button type="button" className="qd-think" disabled={!value.trim() || busy} onClick={think} title="先保存想法，再选择 Agent 讨论（⌘/Ctrl + 回车）">
          <Icon name="message" size={15} />
          交给 Agent 讨论
        </button>
      <button type="submit" className="qd-enter" disabled={!value.trim() || busy} aria-label="记为待办或文字">
        <Icon name="enter" size={15} />
        记录
      </button>
    </form>
  );
}
