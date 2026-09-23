import { NAVIGATION, ROLE_LABELS, visibleNavigationGroups } from '../../lib/workspace';
import { useWorkspace } from './WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Bell,
  ChevronRight,
  Menu,
  Moon,
  PackageOpen,
  PanelLeftClose,
  Search,
  Sun,
  Warehouse,
} from 'lucide-react';

function WorkspaceNavigation({ role, hiddenModules, sidebarCompact, activeSection, navigateTo }) {
  const groups = visibleNavigationGroups(NAVIGATION, { role, hiddenModules });

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Primary navigation">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          {!sidebarCompact && (
            <p className="px-3 pb-1 text-[10px] font-bold tracking-[0.18em] text-muted-foreground/70 uppercase">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={sidebarCompact ? item.label : undefined}
                onClick={() => navigateTo(item.id)}
                className={`group flex h-10 w-full items-center rounded-lg px-3 text-sm font-medium transition-all ${sidebarCompact ? 'justify-center' : 'gap-3'} ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {!sidebarCompact && <span className="truncate">{item.label}</span>}
                {!sidebarCompact && item.badge && (
                  <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold ${active ? 'bg-primary-foreground/15' : 'bg-muted text-muted-foreground'}`}>
                    {item.badge}
                  </span>
                )}
                {!sidebarCompact && !item.badge && (
                  <ChevronRight className={`ml-auto size-3 opacity-0 transition-opacity ${active ? 'opacity-70' : 'group-hover:opacity-60'}`} />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function WorkspaceChrome({ children }) {
  const {
    workspaceProfile,
    hiddenModules,
    role,
    session,
    activeSection,
    navigateTo,
    sidebarCompact,
    setSidebarCompact,
    mobileNavOpen,
    setMobileNavOpen,
    globalSearch,
    setGlobalSearch,
    setCommandQuery,
    setCommandPaletteOpen,
    darkMode,
    setDarkMode,
    notifications,
    handleLogout,
    pageMeta,
    locationId,
    setLocationId,
    locations,
    loading,
    apiError,
    moduleWarning,
    liveStatus,
  } = useWorkspace();
  const workspaceName = workspaceProfile.name || 'Invexa Retail';
  const workspaceIndustry = workspaceProfile.industry || 'Inventory operations';

  return (
    <div className="flex min-h-svh">
      <aside className={`sticky top-0 hidden h-svh shrink-0 border-r bg-sidebar lg:flex lg:flex-col ${sidebarCompact ? 'w-[76px]' : 'w-[264px]'}`}>
        <div className={`flex h-16 items-center border-b px-4 ${sidebarCompact ? 'justify-center' : 'gap-3'}`}>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary shadow-sm shadow-primary/25">
            <PackageOpen className="size-5 text-primary-foreground" />
          </div>
          {!sidebarCompact && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">{workspaceName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{workspaceIndustry}</p>
            </div>
          )}
        </div>
        <WorkspaceNavigation
          role={role}
          hiddenModules={hiddenModules}
          sidebarCompact={sidebarCompact}
          activeSection={activeSection}
          navigateTo={navigateTo}
        />
        <div className="border-t p-3">
          <button
            type="button"
            onClick={() => setSidebarCompact((value) => !value)}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <PanelLeftClose className={`size-4 transition-transform ${sidebarCompact ? 'rotate-180' : ''}`} />
            {!sidebarCompact && 'Collapse sidebar'}
          </button>
        </div>
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[285px] p-0">
          <SheetHeader className="flex h-16 flex-row items-center justify-between border-b px-4 py-0">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary">
                <PackageOpen className="size-5 text-primary-foreground" />
              </div>
              <div>
                <SheetTitle className="text-sm">{workspaceName}</SheetTitle>
                <SheetDescription className="text-[11px]">{workspaceIndustry}</SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <WorkspaceNavigation
            role={role}
            hiddenModules={hiddenModules}
            sidebarCompact={false}
            activeSection={activeSection}
            navigateTo={navigateTo}
          />
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/90 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
              <Menu className="size-5" />
            </Button>
            <div className="relative hidden md:block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setCommandQuery(globalSearch);
                    setCommandPaletteOpen(true);
                  }
                }}
                className="w-72 bg-muted/40 pl-9 pr-14"
                placeholder="Search items, tasks, transfers…"
                aria-label="Search workspace"
              />
              <button
                type="button"
                onClick={() => {
                  setCommandQuery(globalSearch);
                  setCommandPaletteOpen(true);
                }}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted"
                aria-label="Open command search"
              >
                ⌘ K
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 xl:flex">
              <span className={`size-2 rounded-full ${liveStatus === 'live' ? 'bg-emerald-500' : liveStatus === 'offline' ? 'bg-destructive' : 'bg-amber-500'}`} />
              <span className="text-xs text-muted-foreground">{liveStatus === 'live' ? 'Live sync' : liveStatus === 'offline' ? 'Offline queue' : liveStatus === 'polling' ? 'Polling sync' : 'Sync reconnecting'}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle theme">
              {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="relative" onClick={() => navigateTo('alerts')} aria-label="Open notifications">
              <Bell className="size-4" />
              {notifications.length > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive ring-2 ring-background" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                      {(session.user.name ?? session.user.email ?? '?').slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden text-left sm:block">
                    <p className="max-w-32 truncate text-xs font-semibold">{session.user.name ?? session.user.email}</p>
                    <p className="text-[10px] text-muted-foreground">{ROLE_LABELS[role] ?? role}</p>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>My account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {role === 'ADMIN' && <DropdownMenuItem onClick={() => navigateTo('admin')}>Administration</DropdownMenuItem>}
                <DropdownMenuItem onClick={handleLogout}>Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                <span>{workspaceName}</span>
                <ChevronRight className="size-3" />
                <span className="text-foreground">{pageMeta[0]}</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{pageMeta[0]}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{pageMeta[1]}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="w-48 bg-background">
                  <Warehouse className="size-4 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {loading && <Badge variant="outline">Syncing…</Badge>}
              {liveStatus === 'live' && <Badge variant="success" title="Changes from other users and devices appear automatically">Live</Badge>}
              {liveStatus === 'offline' && <Badge variant="warning" title="No network - showing the last synced data">Offline</Badge>}
              {liveStatus === 'polling' && <Badge variant="warning" title="Live updates are temporarily unavailable; data refreshes automatically every 12 seconds.">Polling sync</Badge>}
              {(liveStatus === 'reconnecting' || liveStatus === 'stale') && <Badge variant="warning" title="Live updates paused - refreshing periodically until reconnected">{liveStatus === 'stale' ? 'Sync stale' : 'Reconnecting…'}</Badge>}
              {apiError && <Badge variant="destructive" title={apiError}>Stock sync failed</Badge>}
              {!apiError && moduleWarning && <Badge variant="warning" title={moduleWarning}>Module limited</Badge>}
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
