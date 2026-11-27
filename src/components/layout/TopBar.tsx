import { useEffect, useState } from 'react';
import { usePreferences } from '../../state/preferences';
import { QuanDeckLogo } from '../brand/QuanDeckLogo';
import { Icon, type IconName } from '../ui/Icon';
import './product-shell.css';

export type MainPage = 'home' | 'notes' | 'ideas' | 'projects' | 'monitor' | 'search';

const navigation: { page: MainPage; label: string; icon: IconName }[] = [
  { page: 'home', label: '首页', icon: 'home' },
  { page: 'notes', label: '帮你记', icon: 'pencil' },
  { page: 'ideas', label: '帮你想', icon: 'bulb' },
  { page: 'projects', label: '帮你管', icon: 'check-square' },
  { page: 'monitor', label: '帮你盯', icon: 'clock' },
  { page: 'search', label: '帮你找', icon: 'search' },
];

type NavigationProps = { page: MainPage; onNavigate: (page: MainPage) => void };

export function ProductNavigation({ page, onNavigate, onSettings, running, offline }: NavigationProps & {
  onSettings: () => void;
  running: number;
  offline: boolean;
}) {
  const { preferences } = usePreferences();
  return <aside className="qd-product-navigation">
    <button className="qd-product-brand" type="button" onClick={() => onNavigate('home')} aria-label="QuanDeck 首页"><QuanDeckLogo /></button>
    <nav aria-label="主导航">
      {navigation.map(item => <button type="button" key={item.page} aria-current={page === item.page ? 'page' : undefined} onClick={() => onNavigate(item.page)}>
        <Icon name={item.icon} size={20} /><span>{item.label}</span>
      </button>)}
    </nav>
    <div className="qd-rail-footer">
      {running > 0 && !offline && <button type="button" className="qd-rail-activity" onClick={() => onNavigate('monitor')} title="查看 Agent 执行情况">
        <span className="qd-rail-status-dot" aria-hidden="true" /><span>Agent 执行中</span><strong>{running} 项</strong>
      </button>}
      <button className="qd-product-settings" type="button" onClick={onSettings} aria-haspopup="dialog" aria-label="设置" title="个人资料与设置">
        <span className="qd-product-avatar" aria-hidden="true">
          {preferences.avatar ? <img alt="" src={preferences.avatar} /> : Array.from(preferences.name)[0] || '我'}
        </span>
        <span className="qd-profile-label"><strong>{preferences.name || '我'}</strong><small>设置</small></span>
        <Icon name="sliders" size={17} />
      </button>
    </div>
  </aside>;
}

export function TopBar({ page, onSearch, onMonitor, attentionCount, children }: {
  page: MainPage;
  onSearch: (query: string) => void;
  onMonitor: () => void;
  attentionCount: number;
  children?: React.ReactNode;
}) {
  const current = navigation.find(item => item.page === page)!;
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const [query, setQuery] = useState('');
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      onSearch('');
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [onSearch]);
  return <header className="qd-product-top">
    <div className="qd-product-top-context">
      {page === 'notes' ? <h1>帮你记</h1> : <><Icon name={current.icon} size={15} /><span>{current.label}</span></>}
      {children && <><Icon name="chevron-right" size={13} /><strong>{children}</strong></>}
    </div>
    {page !== 'search' && <form role="search" className="qd-product-quick-search" onSubmit={event => {
      event.preventDefault();
      onSearch(query.trim());
      setQuery('');
    }}>
      <Icon name="search" size={16} />
      <input aria-label="全局搜索" placeholder="搜索项目、任务、知识…" type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} />
      {query.trim() ? <button type="submit" aria-label="搜索"><Icon name="arrow-right" size={16} /></button>
        : <kbd aria-hidden="true">{modifier} K</kbd>}
    </form>}
    <button className="qd-product-bell" type="button" onClick={onMonitor} aria-label={'任务提醒，' + attentionCount + ' 项需要处理'} title="查看任务提醒">
      <Icon name="bell" size={21} />{attentionCount > 0 && <span aria-hidden="true">{attentionCount}</span>}
    </button>
  </header>;
}
