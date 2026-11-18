import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import type { Agency, AgencyUser } from '@/lib/types';
import { useLocation } from 'wouter';
import { isPublicAuthPath } from '@/lib/auth';
import { setCurrency } from '@/lib/money';
import { setLanguage } from '@/i18n';
import { readDemoFlag, writeDemoFlag } from '@/lib/admin';

interface AuthContextType {
  session: { id: string; email: string } | null;
  profile: AgencyUser | null;
  agency: Agency | null;
  isOwner: boolean;
  isOwnerOrManager: boolean;
  /** True when the owner has removed this user from the agency. */
  isDeactivated: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
  /** Call this after agency setup completes to reload profile+agency without a page refresh. */
  refreshProfile: () => Promise<void>;
  /** User id whose profile fetch has finished (null while unknown). */
  profileLoadedFor: string | null;
  /** Signed in as a platform superadmin (listed in platform_admins). */
  isPlatformAdmin: boolean;
  /** A superadmin inside the resettable demo agency (this browser tab). */
  inDemo: boolean;
  /** Superadmin: reset the demo agency and enter it as its Owner. */
  openDemo: () => Promise<void>;
  /** Superadmin: throw away every change made in the demo and go back to /admin. */
  leaveDemo: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchProfileAndAgency(userId: string) {
  const [{ data: profileData }, { data: isAdmin }] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
    supabase.rpc('is_platform_admin'),
  ]);

  if (!profileData) return { profile: null, agency: null, isAdmin: isAdmin === true };

  const { data: agencyData } = await supabase
    .from('agencies')
    .select('*')
    .eq('id', profileData.agency_id)
    .single();

  return { profile: profileData as AgencyUser, agency: agencyData as Agency | null, isAdmin: isAdmin === true };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<AgencyUser | null>(null);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [inDemo, setInDemo] = useState<boolean>(() => readDemoFlag());
  const [, setLocation] = useLocation();
  // Id of the user the cached data belongs to; used to detect a user switch.
  const lastUserIdRef = useRef<string | null>(null);

  /** Explicitly reload profile + agency. Call after signup/setup completes. */
  const refreshProfile = useCallback(async () => {
    const { data: { session: current } } = await supabase.auth.getSession();
    if (!current?.user) return;
    const { profile: p, agency: a } = await fetchProfileAndAgency(current.user.id);
    setProfileLoadedFor(current.user.id);
    if (p) setProfile(p);
    if (a) setAgency(a);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      setIsLoading(true);
      const { data: { session: authSession } } = await supabase.auth.getSession();

      if (authSession?.user) {
        if (mounted) {
          lastUserIdRef.current = authSession.user.id;
          setSession({ id: authSession.user.id, email: authSession.user.email ?? '' });
        }
        const { profile: p, agency: a, isAdmin } = await fetchProfileAndAgency(authSession.user.id);
        if (mounted) setProfileLoadedFor(authSession.user.id);
        if (mounted) {
          setProfile(p);
          setAgency(a);
          setIsPlatformAdmin(isAdmin);
          // A superadmin belongs on the superadmin page unless inside the demo.
          if (isAdmin && !readDemoFlag()) {
            if (window.location.pathname !== '/admin' && window.location.pathname !== '/reset-password') setLocation('/admin');
          // User authenticated but no agency profile yet — send to registration to create one
          // (not while setting a new password from a reset link)
          } else if (!p && window.location.pathname !== '/register' && window.location.pathname !== '/join' && window.location.pathname !== '/reset-password') {
            setLocation('/register');
          }
        }
      } else {
        if (mounted) {
          setSession(null);
          setProfile(null);
          setAgency(null);
        }
      }

      if (mounted) setIsLoading(false);
    }

    loadSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (!mounted) return;

      // Cached query data is keyed by agency, not user. Drop it whenever the
      // signed-in user changes (including sign-out) so the next login never
      // sees the previous user's data.
      const newUserId = currentSession?.user?.id ?? null;
      const userChanged = newUserId !== lastUserIdRef.current;
      if (userChanged) {
        queryClient.clear();
        lastUserIdRef.current = newUserId;
      }

      if (currentSession?.user) {
        setSession({ id: currentSession.user.id, email: currentSession.user.email ?? '' });

        // A password-reset link signs the user in; make sure they land on the
        // page that lets them choose a new password, wherever the link pointed.
        if (event === 'PASSWORD_RECOVERY' && window.location.pathname !== '/reset-password') {
          setLocation('/reset-password');
        }

        // On SIGNED_IN we may not yet have profile (e.g. first login, or token refresh).
        // Fetch it; register.tsx calls refreshProfile() explicitly after setup.
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          const { profile: p, agency: a, isAdmin } = await fetchProfileAndAgency(currentSession.user.id);
          if (mounted) setProfileLoadedFor(currentSession.user.id);
          if (mounted) {
            if (userChanged || isAdmin) setIsPlatformAdmin(isAdmin);
            // A different user just signed in: take the fetch result as-is, even
            // null, so the previous user's profile/agency can never linger. For
            // the same user (e.g. TOKEN_REFRESHED) keep the existing values if
            // the refetch comes back empty (transient failure).
            if (userChanged) {
              setProfile(p);
              setAgency(a);
            } else {
              if (p) setProfile(p);
              if (a) setAgency(a);
            }
          }
        }
      } else {
        setSession(null);
        setIsPlatformAdmin(false);
        // Session gone (sign-out or expiry): the next sign-in starts outside the demo.
        writeDemoFlag(false);
        setInDemo(false);
        setProfile(null);
        setAgency(null);
        const path = window.location.pathname;
        if (!isPublicAuthPath(path)) {
          setLocation('/login');
        }

      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [setLocation]);

  const signOut = async () => {
    // Signing out from inside the demo throws its changes away too (best effort).
    if (readDemoFlag()) await supabase.rpc('admin_leave_demo').then(() => undefined, () => undefined);
    await supabase.auth.signOut();
    queryClient.clear();
    lastUserIdRef.current = null;
    setProfile(null);
    setAgency(null);
    setSession(null);
    setIsPlatformAdmin(false);
    writeDemoFlag(false);
    setInDemo(false);
    setLocation('/login');
  };

  const openDemo = useCallback(async () => {
    const { error } = await supabase.rpc('admin_open_demo');
    if (error) throw error;
    writeDemoFlag(true);
    queryClient.clear();
    await refreshProfile();
    setInDemo(true);
    setLocation('/dashboard');
  }, [refreshProfile, setLocation]);

  const leaveDemo = useCallback(async () => {
    const { error } = await supabase.rpc('admin_leave_demo');
    if (error) throw error;
    writeDemoFlag(false);
    setInDemo(false);
    queryClient.clear();
    setLocation('/admin');
  }, [setLocation]);

  // Show amounts in the agency's currency, and use the person's chosen language.
  useEffect(() => {
    setCurrency(agency?.currency);
  }, [agency?.currency]);
  useEffect(() => {
    if (agency?.language) setLanguage(agency.language);
  }, [agency?.language]);

  const isOwner = profile?.role === 'owner';
  const isOwnerOrManager = profile?.role === 'owner' || profile?.role === 'manager';
  const isDeactivated = !!profile?.deactivated_at;

  return (
    <AuthContext.Provider value={{ session, profile, agency, isOwner, isOwnerOrManager, isDeactivated, isLoading, signOut, refreshProfile, profileLoadedFor, isPlatformAdmin, inDemo, openDemo, leaveDemo }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
