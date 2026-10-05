import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "katex/dist/katex.min.css";
import "./styles.css";
import { AppProvider, useApp } from "@/app/state";
import { Shell } from "@/app/Shell";
import { EmptyState, LoadingState } from "@/components/ui";
import { ActivityPage, ConflictResolution } from "@/features/activity/ActivityPages";
import { ConceptOutlinePage } from "@/features/concepts/ConceptOutline";
import { ConnectPage } from "@/features/connect/ConnectPage";
import { LectureWorkspace } from "@/features/lecture/LectureWorkspace";
import { ConceptDetail, HistoryPage, ProgressPage } from "@/features/progress/ProgressPages";
import { QuestionBankPage } from "@/features/question/QuestionList";
import { QuestionPractice } from "@/features/question/QuestionPractice";
import { ReviewHome, ReviewSession } from "@/features/review/ReviewPages";
import { SessionWrapUp } from "@/features/session/SessionWrapUp";
import { RepairPreview, SettingsPage } from "@/features/settings/SettingsPages";
import { SourceDetail, SourcesPage } from "@/features/sources/SourcesPages";
import { CourseLectures, StudyHome } from "@/features/study/StudyPages";

// Views are private projections from the loopback Brain: no retries that could hide an outage,
// and no refetch-on-focus storms while a recording is playing.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } } });

function Index() {
  const app = useApp();
  if (!app.ready) return <LoadingState label="Opening…" />;
  return <Navigate to={app.pairing.state === "paired" ? "/study" : "/connect"} replace />;
}

/** `/search` is a shareable way to open the scoped search overlay over Study. */
function SearchRoute() {
  const app = useApp();
  const navigate = useNavigate();
  useEffect(() => {
    app.setSearchOpen(true);
    navigate("/study", { replace: true });
  }, [app, navigate]);
  return null;
}

function NotFound() {
  return <EmptyState title="Nothing at this address">The link may be old. Your records are not affected.</EmptyState>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppProvider>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Index />} />
              <Route path="connect" element={<ConnectPage />} />
              <Route path="study" element={<StudyHome />} />
              <Route path="study/sessions/:sessionId/summary" element={<SessionWrapUp />} />
              <Route path="courses/:courseId" element={<CourseLectures />} />
              <Route path="courses/:courseId/lectures/:lectureId" element={<LectureWorkspace />} />
              <Route path="courses/:courseId/sources/:sourceId" element={<SourceDetail />} />
              <Route path="courses/:courseId/questions" element={<QuestionBankPage />} />
              <Route path="courses/:courseId/questions/:questionId" element={<QuestionPractice />} />
              <Route path="courses/:courseId/outline" element={<ConceptOutlinePage />} />
              <Route path="courses/:courseId/concepts/:typedId" element={<ConceptDetail />} />
              <Route path="review" element={<ReviewHome />} />
              <Route path="review/sessions/:sessionId" element={<ReviewSession />} />
              <Route path="progress" element={<ProgressPage />} />
              <Route path="history/:sessionId?" element={<HistoryPage />} />
              <Route path="sources" element={<SourcesPage />} />
              <Route path="activity/conflicts/:conflictId" element={<ConflictResolution />} />
              <Route path="activity/:requestId?" element={<ActivityPage />} />
              <Route path="settings/maintenance/:operationId" element={<RepairPreview />} />
              <Route path="settings/:section?" element={<SettingsPage />} />
              <Route path="search" element={<SearchRoute />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AppProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
