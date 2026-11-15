import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { AgentLogo } from "../ui/AgentLogo";
import type { Agent } from "../../data/types";

const PRESETS = ["#8A6FB0", "#4F8A86", "#B0705A", "#5E7FA8", "#8F8A4A", "#A35F7E", "#5B6B7A"];
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

/** 读取并缩放为 96px 方形 PNG，避免把大图存进本地配置 */
function toAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取失败"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("无法解析图片"));
      img.onload = () => {
        const S = 96;
        const canvas = document.createElement("canvas");
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("浏览器不支持图片处理"));
        const k = Math.max(S / img.width, S / img.height);
        const w = img.width * k;
        const h = img.height * k;
        ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** 轻量自定义 Agent 表单：名称必填；头像、连接方式可选；保存后为“未连接 · 待配置”，不派发。 */
export function CustomAgentForm({
  onDone,
  agent: editing,
}: {
  onDone: (agentId?: string) => void;
  /** 传入时为编辑模式：复用同一表单，预填现有配置 */
  agent?: Agent;
}) {
  const { api, toast } = useWorkdeck();
  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.color ?? PRESETS[0]);
  const [logo, setLogo] = useState<string | null>(editing?.logo ?? null);
  const [endpoint, setEndpoint] = useState(editing?.endpoint ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => nameRef.current?.focus(), []);

  const preview: Agent = {
    id: "preview",
    name: name.trim() || "新",
    short: name,
    color,
    connection: "offline",
    connectionNote: "",
    tracked: true,
    starred: false,
    pinned: false,
    today: { minutes: null, tokens: null, sessions: null },
    daily14: [],
    scan: { state: "idle", lastAt: null },
    custom: true,
    logo,
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      setError("头像仅支持 PNG、JPEG 或 WebP");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("图片过大（上限 5 MB）");
      return;
    }
    try {
      setLogo(await toAvatar(file));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("请填写名称");
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    const input = { name, color, logo, endpoint };
    const r = editing
      ? { ...(await api.updateCustomAgent(editing.id, input)), agentId: editing.id }
      : await api.addCustomAgent(input);
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? "保存失败");
      return;
    }
    toast(r.message ?? (editing ? "已更新" : "已添加"));
    onDone(r.agentId);
  };

  return (
    <form
      className="qd-custom-form"
      onSubmit={submit}
      aria-label={editing ? `编辑自定义 Agent：${editing.name}` : "自定义 Agent"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <div className="qd-custom-id">
        <button
          type="button"
          className="qd-avatar-pick"
          onClick={() => fileRef.current?.click()}
          aria-label={logo ? "更换头像" : "上传头像（可选）"}
          title="上传 PNG / JPEG / WebP"
        >
          <AgentLogo agent={preview} size={40} label={`头像预览：${preview.name}`} />
          <span className="qd-avatar-pick-badge" aria-hidden="true">
            <Icon name="pencil" size={11} />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT.join(",")}
          className="qd-visually-hidden"
          aria-label="选择头像图片"
          tabIndex={-1}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <label className="qd-custom-name" htmlFor={`${id}-name`}>
          <span>
            名称 <em aria-hidden="true">*</em>
          </span>
          <input
            id={`${id}-name`}
            ref={nameRef}
            value={name}
            maxLength={32}
            required
            aria-required="true"
            aria-invalid={error === "请填写名称" || undefined}
            placeholder="例如：内部评审 Agent"
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
        </label>
      </div>
      {logo && (
        <button type="button" className="qd-link qd-custom-clear" onClick={() => setLogo(null)}>
          移除头像，使用首字
        </button>
      )}

      <fieldset className="qd-custom-colors">
        <legend>主题色</legend>
        <div role="radiogroup" aria-label="主题色">
          {PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`主题色 ${c}`}
              className={`qd-color ${color === c ? "is-on" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="qd-color qd-color-custom" title="自选颜色">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="自选主题色"
            />
            <Icon name="plus" size={12} />
          </label>
        </div>
      </fieldset>

      <details className="qd-custom-more" open={Boolean(editing?.endpoint) || undefined}>
        <summary>
          <Icon name="chevron-right" size={13} className="qd-fold-icon" />
          连接方式 / 会话地址（可选）
        </summary>
        <input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="例如 http://localhost:4000 或本机 CLI 名称"
          aria-label="连接方式或会话地址"
        />
        <p>不保存密钥。</p>
      </details>

      {error && (
        <p className="qd-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="qd-custom-actions">
        <button type="button" className="qd-btn ghost small" onClick={() => onDone()}>
          取消
        </button>
        <button type="submit" className="qd-btn primary small" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </form>
  );
}
