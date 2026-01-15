import { Link, usePage } from '@inertiajs/react'
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { NotificationBell } from "@/components/NotificationBell"
import { ChatIcon } from "@/components/ChatIcon"
import { MobileMenu } from "@/components/MobileMenu"
import { ProfileHoverCard } from "@/components/ProfileHoverCard"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Settings } from "lucide-react"
import { UserBadge } from "@/components/UserBadge"
import { HeaderUsername } from "@/components/HeaderUsername"
import { TermsOfService } from "@/components/TermsOfService"
import { Footer } from "@/components/Footer"
import { CookieBanner } from "@/components/CookieBanner"
import { supabase } from "@/integrations/supabase/client"

interface LayoutProps {
  children: React.ReactNode
}

export const Layout = ({ children }: LayoutProps) => {
  const { auth } = usePage().props as any
  const [user, setUser] = useState<any>(null)
  const [isModerator, setIsModerator] = useState(false)
  const [currentUserUsername, setCurrentUserUsername] = useState("")
  const [currentUserColor, setCurrentUserColor] = useState("")
  const [showTerms, setShowTerms] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)

      if (session?.user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id)

        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false)

        // Load current user profile and color
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", session.user.id)
          .single()

        if (profile) {
          setCurrentUserUsername(profile.username)
        }

        // Load current user color
        const { data: achievements } = await supabase
          .from("user_achievements")
          .select(`
            achievement_id,
            achievements (
              reward_type,
              reward_value
            )
          `)
          .eq("user_id", session.user.id)

        if (achievements) {
          const colorRewards = achievements
            .filter((a: any) => a.achievements?.reward_type === "username_color")
            .map((a: any) => a.achievements.reward_value)

          const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan']
          for (const p of priority) {
            if (colorRewards.includes(p)) {
              setCurrentUserColor(p)
              break
            }
          }
        }

        // Check if user has accepted terms
        const { data: termsData } = await supabase
          .from("user_terms_acceptance")
          .select("*")
          .eq("user_id", session.user.id)
          .maybeSingle()

        if (!termsData) {
          setShowTerms(true)
        } else {
          setTermsAccepted(true)
        }
      }
    }

    checkAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    toast.success("Вышли")
    window.location.href = '/'
  }

  const handleAcceptTerms = async () => {
    if (!user) return

    await supabase
      .from("user_terms_acceptance")
      .insert({
        user_id: user.id,
      })

    setShowTerms(false)
    setTermsAccepted(true)
    toast.success("Спасибо за согласие с правилами")
  }

  const handleDeclineTerms = async () => {
    await supabase.auth.signOut()
    window.location.href = '/auth'
    toast.info("Вы покинули сайт")
  }

  return (
    <div className="bg-background min-h-screen flex flex-col">
      <div className="flex-1 min-h-0">
        <header className="bg-board-header text-board-header-foreground p-3 sm:p-4 border-b border-border">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
            <Link href="/" className="flex-shrink-0">
              <img
                src="/photoes/gomo6.png"
                alt="gomo6"
                className="h-4 sm:h-5 md:h-6 w-auto object-contain max-w-[80px] sm:max-w-[100px] md:max-w-[120px]"
              />
            </Link>
            <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
              <Link href="/settings" className="hidden sm:block">
                <Button variant="ghost" size="sm" className="relative p-2 hover:bg-white/20 hover:text-white transition-colors group">
                  <Settings className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                </Button>
              </Link>
              {user && <NotificationBell userId={user.id} />}
              {user && <ChatIcon userId={user.id} />}
              {user ? (
                <>
                  <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
                    <HeaderUsername userId={user.id} />
                  </div>
                  <MobileMenu
                    user={user}
                    isModerator={isModerator}
                  />
                </>
              ) : (
                <Link href="/auth">
                  <Button variant="secondary" size="sm" className="text-xs sm:text-sm hover:bg-primary hover:text-primary-foreground transition-colors">
                    Войти
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1">
          {children}
        </main>

        <TermsOfService
          open={showTerms}
          onAccept={handleAcceptTerms}
          onDecline={handleDeclineTerms}
          canDecline={true}
        />
      </div>

      <div className="mt-auto">
        <Footer />
        <CookieBanner />
      </div>
    </div>
  )
}