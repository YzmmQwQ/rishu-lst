import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useRoomStore } from '@/stores/roomStore'
import { LIMITS, type UserRole } from '@music-together/shared'
import { Crown, KeyRound, Shield, User } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

interface MembersSectionProps {
  onSetUserRole?: (userId: string, role: 'admin' | 'member') => void
  onGrantAdminByPassword?: (superPassword: string) => void
}

const ROLE_LABELS: Record<UserRole, string> = {
  owner: '房主',
  admin: '管理员',
  member: '成员',
}

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2 }

function getRoleIcon(role: UserRole) {
  switch (role) {
    case 'owner':
      return <Crown className="h-4 w-4 text-yellow-500" />
    case 'admin':
      return <Shield className="h-4 w-4 text-blue-400" />
    case 'member':
      return <User className="h-4 w-4 text-muted-foreground" />
  }
}

export function MembersSection({ onSetUserRole, onGrantAdminByPassword }: MembersSectionProps) {
  const room = useRoomStore((s) => s.room)
  const currentUser = useRoomStore((s) => s.currentUser)
  const isOwner = currentUser?.role === 'owner'
  // 非管理员（member）可凭管理密码提权；已是 owner/admin 不显示入口
  const canRequestAdmin = currentUser?.role === 'member' && (room?.hasSuperPassword ?? false)
  const [tempPwd, setTempPwd] = useState('')

  const handleGrant = () => {
    if (!tempPwd.trim()) {
      toast.error('请输入管理密码')
      return
    }
    onGrantAdminByPassword?.(tempPwd.trim())
    setTempPwd('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">在线成员 ({room?.users.length ?? 0})</h3>
        <Separator className="mt-2 mb-4" />

        <div className="space-y-1">
          {[...(room?.users ?? [])]
            .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))
            .map((user) => (
              <div key={user.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                {getRoleIcon(user.role)}
                <span className="text-sm">{user.nickname}</span>
                {user.id === currentUser?.id && (
                  <Badge variant="secondary" className="text-xs">
                    你
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {ROLE_LABELS[user.role]}
                </Badge>

                {/* Owner can change other users' roles (not their own, not other owners) */}
                {isOwner && user.role !== 'owner' && user.id !== currentUser?.id && onSetUserRole && (
                  <Select value={user.role} onValueChange={(v) => onSetUserRole(user.id, v as 'admin' | 'member')}>
                    <SelectTrigger className="ml-auto h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">管理员</SelectItem>
                      <SelectItem value="member">成员</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* 非管理员凭管理密码获取临时管理权限 */}
      {canRequestAdmin && onGrantAdminByPassword && (
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            管理员钥匙
          </h3>
          <Separator className="mt-2 mb-4" />
          <p className="text-muted-foreground mb-3 text-xs">
            输入房主设置的管理密码即可获得临时管理权限（切歌 / 清队列 / 调音质等）。离开房间或房主上线后自动失效。
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="输入管理密码..."
              value={tempPwd}
              onChange={(e) => setTempPwd(e.target.value)}
              maxLength={LIMITS.SUPER_PASSWORD_MAX_LENGTH}
              className="flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleGrant()}
            />
            <Button size="sm" onClick={handleGrant}>
              获取权限
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
