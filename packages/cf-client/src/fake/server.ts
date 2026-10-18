import express, { type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import type { CfProblem, CfProblemStatistics, CfSubmission, CfUser } from '../types';

export interface FailNextRule {
  count: number;
  kind: 'rate-limit' | '500' | 'timeout' | 'network';
}

export class FakeCodeforcesServer {
  private readonly app: express.Express;
  private server: Server | null = null;
  private port: number = 0;

  // In-memory state
  private problems: CfProblem[] = [];
  private statistics: CfProblemStatistics[] = [];
  private users: Map<string, CfUser> = new Map();
  private submissions: CfSubmission[] = [];

  // Failure controls
  private activeFailNext: FailNextRule | null = null;
  private isOutage = false;
  private recentStatusTruncateTo: number | null = null;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  public seedProblem(problem: CfProblem, stats?: Partial<CfProblemStatistics>): void {
    const existingIdx = this.problems.findIndex(
      (p) => p.contestId === problem.contestId && p.index === problem.index,
    );
    if (existingIdx !== -1) {
      this.problems[existingIdx] = problem;
      this.statistics[existingIdx] = {
        contestId: problem.contestId,
        index: problem.index,
        solvedCount: stats?.solvedCount ?? 100,
        ...stats,
      };
    } else {
      this.problems.push(problem);
      this.statistics.push({
        contestId: problem.contestId,
        index: problem.index,
        solvedCount: stats?.solvedCount ?? 100,
        ...stats,
      });
    }
  }

  public seedUser(user: Partial<CfUser> & { handle: string }): void {
    const fullUser: CfUser = {
      rating: 1200,
      maxRating: 1200,
      rank: 'pupil',
      maxRank: 'pupil',
      contribution: 0,
      friendOfCount: 0,
      titlePhoto: 'https://userpic.codeforces.org/no-title.jpg',
      avatar: 'https://userpic.codeforces.org/no-avatar.jpg',
      registrationTimeSeconds: Math.floor(Date.now() / 1000) - 86400 * 365,
      lastOnlineTimeSeconds: Math.floor(Date.now() / 1000),
      ...user,
      handle: user.handle,
    };
    this.users.set(user.handle.toLowerCase(), fullUser);
  }

  public addSubmission(submission: CfSubmission): void {
    // Newest submissions first
    const existing = this.submissions.findIndex((s) => s.id === submission.id);
    if (existing !== -1) {
      this.submissions[existing] = submission;
    } else {
      this.submissions.unshift(submission);
      this.submissions.sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
    }
  }

  public setVerdict(submissionId: bigint | number | string, verdict: string): void {
    const targetId = BigInt(submissionId);
    const sub = this.submissions.find((s) => s.id === targetId);
    if (sub) {
      sub.verdict = verdict;
    }
  }

  public failNext(count: number, kind: 'rate-limit' | '500' | 'timeout' | 'network'): void {
    this.activeFailNext = { count, kind };
  }

  public setOutage(enabled: boolean): void {
    this.isOutage = enabled;
  }

  public setRecentStatusTruncation(maxItems: number | null): void {
    this.recentStatusTruncateTo = maxItems;
  }

  public reset(): void {
    this.problems = [];
    this.statistics = [];
    this.users.clear();
    this.submissions = [];
    this.activeFailNext = null;
    this.isOutage = false;
    this.recentStatusTruncateTo = null;
  }

  public async start(desiredPort = 0): Promise<string> {
    return new Promise((resolve) => {
      this.server = createServer(this.app);
      this.server.listen(desiredPort, () => {
        const addr = this.server!.address();
        this.port = typeof addr === 'object' && addr ? addr.port : desiredPort;
        resolve(`http://127.0.0.1:${this.port}/api`);
      });
    });
  }

  public async close(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  public getUrl(): string {
    return `http://127.0.0.1:${this.port}/api`;
  }

  private setupRoutes(): void {
    // Interceptor for simulated failures & outages
    this.app.use((req, res, next) => {
      if (this.isOutage) {
        res.status(503).json({
          status: 'FAILED',
          comment: 'Codeforces is temporarily unavailable (outage simulation)',
        });
        return;
      }

      if (this.activeFailNext && this.activeFailNext.count > 0) {
        this.activeFailNext.count--;
        const kind = this.activeFailNext.kind;
        if (this.activeFailNext.count === 0) {
          this.activeFailNext = null;
        }

        if (kind === '500') {
          res.status(500).json({ status: 'FAILED', comment: 'Internal Server Error' });
          return;
        }
        if (kind === 'rate-limit') {
          res.status(429).json({
            status: 'FAILED',
            comment: 'Call limit exceeded: 5 requests per second',
          });
          return;
        }
        if (kind === 'network') {
          req.socket.destroy();
          return;
        }
        if (kind === 'timeout') {
          // Never respond to trigger client timeout
          return;
        }
      }

      next();
    });

    // GET /api/problemset.problems
    this.app.get('/api/problemset.problems', (_req: Request, res: Response) => {
      res.json({
        status: 'OK',
        result: {
          problems: this.problems,
          problemStatistics: this.statistics,
        },
      });
    });

    // GET /api/problemset.recentStatus?count=N
    this.app.get('/api/problemset.recentStatus', (req: Request, res: Response) => {
      const count = Math.min(
        1000,
        Math.max(1, parseInt((req.query['count'] as string) || '10', 10)),
      );
      let results = [...this.submissions];
      if (this.recentStatusTruncateTo !== null) {
        results = results.slice(0, this.recentStatusTruncateTo);
      } else {
        results = results.slice(0, count);
      }

      // Serialize BigInt id to number or string in response
      const serialized = results.map((s) => ({
        ...s,
        id: Number(s.id),
      }));

      res.json({
        status: 'OK',
        result: serialized,
      });
    });

    // GET /api/user.status?handle=X&from=Y&count=Z
    this.app.get('/api/user.status', (req: Request, res: Response) => {
      const handle = (req.query['handle'] as string)?.toLowerCase();
      const from = Math.max(1, parseInt((req.query['from'] as string) || '1', 10));
      const count = Math.min(
        100,
        Math.max(1, parseInt((req.query['count'] as string) || '10', 10)),
      );

      if (!handle) {
        res.status(400).json({ status: 'FAILED', comment: 'handle: Parameter not found' });
        return;
      }

      const userSubs = this.submissions.filter((s) =>
        s.author.members.some((m) => m.handle.toLowerCase() === handle),
      );

      const page = userSubs.slice(from - 1, from - 1 + count).map((s) => ({
        ...s,
        id: Number(s.id),
      }));

      res.json({
        status: 'OK',
        result: page,
      });
    });

    // GET /api/user.info?handles=h1;h2
    this.app.get('/api/user.info', (req: Request, res: Response) => {
      const handlesParam = req.query['handles'] as string;
      if (!handlesParam) {
        res.status(400).json({ status: 'FAILED', comment: 'handles: Parameter not found' });
        return;
      }

      const handles = handlesParam
        .split(';')
        .map((h) => h.trim())
        .filter(Boolean);
      const matched: CfUser[] = [];

      for (const h of handles) {
        const u = this.users.get(h.toLowerCase());
        if (!u) {
          res.status(400).json({
            status: 'FAILED',
            comment: `handles: User with handle ${h} not found`,
          });
          return;
        }
        matched.push(u);
      }

      res.json({
        status: 'OK',
        result: matched,
      });
    });
  }
}
