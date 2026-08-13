"use client";

import { useActionState } from "react";
import { login, signup, type AuthState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LineChart } from "lucide-react";
import { ThemeToggle } from "@/components/app/theme-toggle";

const initial: AuthState = {};

export default function LoginPage() {
  const [loginState, loginAction, loginPending] = useActionState(login, initial);
  const [signupState, signupAction, signupPending] = useActionState(
    signup,
    initial,
  );

  return (
    <div className="relative flex min-h-svh items-center justify-center p-4">
      {/* The sidebar carries the switch everywhere else, and there is no sidebar
          here — so without this, the one screen a signed-out reader can reach is
          the one screen whose theme they cannot change. */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LineChart className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">ICT Trading Journal</h1>
          <p className="text-sm text-muted-foreground">
            Log every trade. Find your edge.
          </p>
        </div>

        <Tabs defaultValue="login">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card>
              <CardHeader>
                <CardTitle>Welcome back</CardTitle>
                <CardDescription>
                  Sign in with your email and password.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form action={loginAction} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  {loginState.error && (
                    <p className="text-sm text-destructive">{loginState.error}</p>
                  )}
                  <Button type="submit" className="w-full" disabled={loginPending}>
                    {loginPending ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="signup">
            <Card>
              <CardHeader>
                <CardTitle>Create your account</CardTitle>
                <CardDescription>
                  One account — your private journal.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form action={signupAction} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </div>
                  {signupState.error && (
                    <p className="text-sm text-destructive">
                      {signupState.error}
                    </p>
                  )}
                  {signupState.message && (
                    <p className="text-sm text-muted-foreground">
                      {signupState.message}
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={signupPending}
                  >
                    {signupPending ? "Creating…" : "Create account"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
