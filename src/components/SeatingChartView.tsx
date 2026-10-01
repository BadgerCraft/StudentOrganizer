import React, { useState, useEffect } from 'react';
import {
  Lock,
  Unlock,
  Shuffle,
  SortAsc,
  Search,
  Maximize2,
  Minimize2,
  UserCheck,
  UserX,
  ExternalLink,
  Plus,
  Minus,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Settings
} from 'lucide-react';
import type {
  SeatingLayout,
  SeatPosition,
  ClassEnrollment,
  Student,
  AttendanceRecord,
  ParticipationDailySummary,
  UUID
} from '../types/schema';
import { SeatingDomainService } from '../services/seatingService';
import { AttendanceService } from '../services/attendanceService';
import { getAppIdentity } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import { getSchoolLocalDate, shiftSchoolDate } from '../utils/dateUtils';
import { db } from '../db/database';

interface SeatingChartViewProps {
  layout: SeatingLayout;
  seatPositions: SeatPosition[];
  enrollments: ClassEnrollment[];
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  dailySummaries: ParticipationDailySummary[];
  selectedEnrollmentIds: UUID[];
  selectedSchoolDate: string;
  userId?: UUID;
  deviceId?: UUID;
  onSelectDate: (date: string) => void;
  onToggleSelectStudent: (enrollmentId: UUID) => void;
  onOpenStudentProfile: (enrollmentId: UUID) => void;
  onOpenStudentSettings?: (student: Student) => void;
  onRefresh: () => void;
}

export const SeatingChartView: React.FC<SeatingChartViewProps> = ({
  layout,
  seatPositions,
  enrollments,
  students,
  attendanceRecords,
  dailySummaries,
  selectedEnrollmentIds,
  selectedSchoolDate,
  userId,
  deviceId,
  onSelectDate,
  onToggleSelectStudent,
  onOpenStudentProfile,
  onOpenStudentSettings,
  onRefresh
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showRandomConfirm, setShowRandomConfirm] = useState(false);
  const [draggedSeat, setDraggedSeat] = useState<SeatPosition | null>(null);
  const [tapMoveMode, setTapMoveMode] = useState(false);
  const [tapMoveSource, setTapMoveSource] = useState<SeatPosition | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  useEffect(() => {
    setTapMoveMode(false);
    setTapMoveSource(null);
    setMoveError(null);
  }, [layout.id, layout.isLocked]);

  const seatingService = new SeatingDomainService(db);
  const attendanceService = new AttendanceService(db);

  const today = getSchoolLocalDate();
  const isHistorical = selectedSchoolDate !== today;

  const studentMap = new Map<UUID, Student>();
  students.forEach(s => studentMap.set(s.id, s));

  const enrollmentMap = new Map<UUID, ClassEnrollment>();
  enrollments.forEach(e => enrollmentMap.set(e.id, e));

  const attendanceMap = new Map<UUID, AttendanceRecord>();
  attendanceRecords
    .filter(a => a.localSchoolDate === selectedSchoolDate && a.deletedAt === null)
    .forEach(a => attendanceMap.set(a.classEnrollmentId, a));

  const summaryMap = new Map<UUID, ParticipationDailySummary>();
  dailySummaries
    .filter(s => s.localSchoolDate === selectedSchoolDate)
    .forEach(s => summaryMap.set(s.classEnrollmentId, s));

  const seatedEnrollmentIds = new Set(
    seatPositions.filter(p => p.deletedAt === null).map(p => p.classEnrollmentId)
  );
  const unseatedEnrollments = enrollments.filter(
    e => e.deletedAt === null && e.enrollmentStatus === 'active' && !seatedEnrollmentIds.has(e.id)
  );

  // Build 2D grid matrix
  const grid: (SeatPosition | null)[][] = [];
  for (let r = 0; r < layout.rows; r++) {
    const rowArr: (SeatPosition | null)[] = [];
    for (let c = 0; c < layout.cols; c++) {
      const pos = seatPositions.find(p => p.row === r && p.col === c && p.deletedAt === null);
      rowArr.push(pos || null);
    }
    grid.push(rowArr);
  }

  const handleToggleLock = async () => {
    await db.seatingLayouts.update(layout.id, {
      isLocked: !layout.isLocked,
      updatedAt: new Date().toISOString()
    });
    onRefresh();
  };

  const handleToggleSize = async () => {
    await db.seatingLayouts.update(layout.id, {
      cardSize: layout.cardSize === 'standard' ? 'compact' : 'standard',
      updatedAt: new Date().toISOString()
    });
    onRefresh();
  };

  const handleAddRow = async () => {
    await db.seatingLayouts.update(layout.id, {
      rows: layout.rows + 1,
      updatedAt: new Date().toISOString()
    });
    onRefresh();
  };

  const handleRemoveRow = async () => {
    if (layout.rows <= 2) return;
    await db.seatingLayouts.update(layout.id, {
      rows: layout.rows - 1,
      updatedAt: new Date().toISOString()
    });
    onRefresh();
  };

  const handleAddCol = async () => {
    await db.seatingLayouts.update(layout.id, {
      cols: layout.cols + 1,
      updatedAt: new Date().toISOString()
    });
    onRefresh();
  };

  const handleRemoveCol = async () => {
    if (layout.cols <= 2) return;
    await db.seatingLayouts.update(layout.id, {
      cols: layout.cols - 1,
      updatedAt: new Date().toISOString()
    });
    onRefresh();
  };

  const getIdentity = async () => {
    const currentIdentity = await getAppIdentity(db);
    if (userId && userId !== currentIdentity.userId) {
      throw new AuthorizationError('Acting teacher has changed. Please refresh.');
    }
    return currentIdentity;
  };

  const handleArrangeAlphabetically = async () => {
    const id = await getIdentity();
    await seatingService.arrangeAlphabetically(layout.id, id.userId, id.deviceId);
    onRefresh();
  };

  const handleConfirmRandomize = async () => {
    const id = await getIdentity();
    await seatingService.randomizeSeats(layout.id, id.userId, id.deviceId);
    setShowRandomConfirm(false);
    onRefresh();
  };

  const handleToggleAttendance = async (enrollmentId: UUID, e: React.MouseEvent) => {
    e.stopPropagation();
    const id = await getIdentity();
    await attendanceService.toggleAttendance(
      layout.classSectionId,
      enrollmentId,
      selectedSchoolDate,
      id.userId,
      id.deviceId
    );
    onRefresh();
  };

  // Drag and drop handlers
  const handleDragStart = (pos: SeatPosition) => {
    if (layout.isLocked) return;
    setDraggedSeat(pos);
  };

  const handleDrop = async (targetRow: number, targetCol: number) => {
    if (!draggedSeat || layout.isLocked) return;
    const id = await getIdentity();
    await seatingService.assignSeat(layout.id, targetRow, targetCol, draggedSeat.classEnrollmentId, id.userId, id.deviceId);
    setDraggedSeat(null);
    onRefresh();
  };

  const handleTapSeat = async (row: number, col: number, seat: SeatPosition | null) => {
    if (!tapMoveMode) {
      if (seat) onToggleSelectStudent(seat.classEnrollmentId);
      return;
    }
    if (layout.isLocked || moveBusy) return;
    if (!tapMoveSource) {
      if (seat) setTapMoveSource(seat);
      return;
    }
    if (tapMoveSource.id === seat?.id) {
      setTapMoveSource(null);
      return;
    }
    setMoveBusy(true);
    setMoveError(null);
    try {
      const identity = await getIdentity();
      await seatingService.assignSeat(layout.id, row, col, tapMoveSource.classEnrollmentId, identity.userId, identity.deviceId);
      setTapMoveSource(null);
      onRefresh();
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : 'Seat move failed. Try again.');
    } finally {
      setMoveBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Controls Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
        {/* Left: Search Student Highlighter */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search student to highlight..."
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
          />
        </div>

        {/* Date Navigation Bar */}
        <div className="flex items-center space-x-1.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold">
          <button
            data-testid="prev-day-btn"
            onClick={() => onSelectDate(shiftSchoolDate(selectedSchoolDate, -1))}
            className="p-1 hover:bg-slate-200 rounded transition text-slate-600"
            title="Previous Day"
            aria-label="Previous school day"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center space-x-1 px-1">
            <Calendar className={`w-3.5 h-3.5 ${isHistorical ? 'text-amber-600' : 'text-blue-600'}`} />
            <input
              type="date"
              data-testid="school-date-picker"
              aria-label="Select school date"
              max={today}
              value={selectedSchoolDate}
              onChange={e => {
                if (e.target.value && e.target.value <= today) {
                  onSelectDate(e.target.value);
                }
              }}
              className="px-1.5 py-0.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono font-medium text-slate-800"
            />
          </div>

          <button
            data-testid="next-day-btn"
            onClick={() => onSelectDate(shiftSchoolDate(selectedSchoolDate, 1))}
            disabled={selectedSchoolDate >= today}
            className="p-1 hover:bg-slate-200 rounded transition text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next Day"
            aria-label="Next school day"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <span className="text-slate-300">|</span>

          <button
            data-testid="today-btn"
            onClick={() => onSelectDate(today)}
            disabled={selectedSchoolDate === today}
            className={`px-2 py-0.5 rounded text-[11px] font-bold transition ${
              selectedSchoolDate === today
                ? 'bg-blue-100 text-blue-800 cursor-default'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer'
            }`}
          >
            Today
          </button>

          {isHistorical && (
            <span
              data-testid="historical-badge"
              className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px] uppercase tracking-wider"
            >
              Historical
            </span>
          )}
        </div>

        {/* Center: Grid Dimension Controls */}
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-700 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
          <span>Grid ({layout.rows} &times; {layout.cols})</span>
          <div className="flex items-center space-x-1 pl-2 border-l border-slate-200">
            <button
              onClick={handleAddRow}
              className="p-1 hover:bg-slate-200 rounded transition"
              title="Add Row"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              onClick={handleRemoveRow}
              className="p-1 hover:bg-slate-200 rounded transition"
              title="Remove Row"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="text-slate-300">|</span>
            <button
              onClick={handleAddCol}
              className="p-1 hover:bg-slate-200 rounded transition"
              title="Add Column"
            >
              <Plus className="w-3 h-3 text-blue-600" />
            </button>
            <button
              onClick={handleRemoveCol}
              className="p-1 hover:bg-slate-200 rounded transition"
              title="Remove Column"
            >
              <Minus className="w-3 h-3 text-blue-600" />
            </button>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleArrangeAlphabetically}
            disabled={layout.isLocked}
            className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl transition disabled:opacity-50"
            title="Arrange Alphabetically"
          >
            <SortAsc className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Alphabetical</span>
          </button>

          <button
            onClick={() => setShowRandomConfirm(true)}
            disabled={layout.isLocked}
            className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl transition disabled:opacity-50"
            title="Randomize Seats"
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Randomize</span>
          </button>

          <button
            onClick={handleToggleSize}
            className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl transition"
            title="Toggle Card Size"
          >
            {layout.cardSize === 'standard' ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Compact</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Standard</span>
              </>
            )}
          </button>

          <button
            onClick={handleToggleLock}
            className={`flex items-center space-x-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition border ${
              layout.isLocked
                ? 'bg-amber-50 text-amber-800 border-amber-300'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {layout.isLocked ? (
              <>
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                <span>Locked</span>
              </>
            ) : (
              <>
                <Unlock className="w-3.5 h-3.5 text-slate-400" />
                <span>Unlocked</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Classroom Front Stage Indicator */}
      <div className="w-full max-w-md mx-auto mb-8 text-center">
        <div className="h-1.5 bg-slate-300 rounded-full mb-1" />
        <span className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">
          Front of Classroom &bull; Whiteboard / Screen
        </span>
      </div>

      {/* Seating Grid */}
      {!layout.isLocked && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
          <button type="button" data-testid="tap-move-seats-btn" aria-pressed={tapMoveMode}
            disabled={moveBusy}
            className="rounded-xl border border-blue-200 bg-white px-4 py-2 font-semibold text-blue-800"
            onClick={() => { setTapMoveMode(!tapMoveMode); setTapMoveSource(null); setMoveError(null); }}>
            {tapMoveMode ? 'Done moving seats' : 'Move seats by tapping'}
          </button>
          {tapMoveMode && <p role="status">{moveBusy ? 'Saving seat move…' : tapMoveSource ? 'Tap the destination seat to move or swap. Tap the same student to cancel.' : 'Tap a student, then tap a destination seat. Occupied seats swap.'}</p>}
          {moveError && <p role="alert" className="text-rose-700">{moveError}</p>}
        </div>
      )}
      <div className="overflow-x-auto pb-24">
        <div
          className="grid gap-3 mx-auto justify-center"
          style={{
            gridTemplateColumns: `repeat(${layout.cols}, minmax(${layout.cardSize === 'compact' ? '140px' : '190px'}, 1fr))`
          }}
        >
          {grid.map((row, r) =>
            row.map((seatPos, c) => {
              if (!seatPos) {
                // Empty Seat Slot
                return (
                  <div
                    key={`empty-${r}-${c}`}
                    data-testid="empty-seat-card"
                    role={tapMoveMode ? 'button' : undefined}
                    tabIndex={tapMoveMode ? 0 : undefined}
                    aria-label={`Empty seat row ${r + 1} column ${c + 1}`}
                    onClick={() => handleTapSeat(r, c, null)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handleTapSeat(r, c, null); } }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDrop(r, c)}
                    className={`rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 text-xs font-medium hover:border-blue-300 transition ${
                      layout.cardSize === 'compact' ? 'h-20' : 'h-28'
                    }`}
                  >
                    Empty Seat
                  </div>
                );
              }

              const enr = enrollmentMap.get(seatPos.classEnrollmentId);
              const student = enr ? studentMap.get(enr.studentId) : null;
              if (!student) return null;

              const isSelected = selectedEnrollmentIds.includes(enr!.id);
              const attendance = attendanceMap.get(enr!.id);
              const isAbsent = attendance?.status === 'absent';
              const summary = summaryMap.get(enr!.id);

              const isHighlighted = searchQuery.trim() !== '' && (
                student.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                student.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (student.preferredName && student.preferredName.toLowerCase().includes(searchQuery.toLowerCase()))
              );

              return (
                <div
                  key={seatPos.id}
                  data-testid="student-seat-card"
                  role="button"
                  tabIndex={0}
                  aria-pressed={tapMoveMode ? tapMoveSource?.id === seatPos.id : isSelected}
                  draggable={!layout.isLocked && !tapMoveMode}
                  onDragStart={() => handleDragStart(seatPos)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDrop(r, c)}
                  onClick={() => handleTapSeat(r, c, seatPos)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void handleTapSeat(r, c, seatPos);
                    }
                  }}
                  className={`relative rounded-2xl border transition-all cursor-pointer select-none p-3 flex flex-col justify-between ${
                    layout.cardSize === 'compact' ? 'h-20' : 'h-28'
                  } ${
                    (tapMoveMode ? tapMoveSource?.id === seatPos.id : isSelected)
                      ? 'ring-2 ring-blue-600 border-blue-600 bg-blue-50/60 shadow-md scale-[1.02]'
                      : isAbsent
                      ? 'bg-slate-100 border-slate-300 opacity-60'
                      : isHighlighted
                      ? 'ring-2 ring-amber-400 border-amber-400 bg-amber-50 shadow-md scale-[1.02]'
                      : 'bg-white border-slate-200/90 hover:border-slate-300 hover:shadow-sm'
                  }`}
                >
                  {/* Top Row: Name, Photo/Initials & Quick Actions */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2.5 truncate">
                      {/* Student Photo or Stylized Initials Avatar */}
                      {student.photoUrl ? (
                        <img
                          src={student.photoUrl}
                          alt={`${student.firstName} ${student.lastName}`}
                          className={`${
                            layout.cardSize === 'compact' ? 'w-7 h-7 rounded-lg' : 'w-11 h-11 rounded-xl'
                          } object-cover border border-slate-200 shadow-xs shrink-0`}
                        />
                      ) : (
                        <div
                          className={`${
                            layout.cardSize === 'compact'
                              ? 'w-7 h-7 rounded-lg text-xs'
                              : 'w-11 h-11 rounded-xl text-sm font-black'
                          } flex items-center justify-center shrink-0 ${
                            isAbsent
                              ? 'bg-slate-300 text-slate-600'
                              : 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-xs'
                          }`}
                        >
                          {student.preferredName?.[0] || student.firstName[0]}
                          {student.lastName[0]}
                        </div>
                      )}

                      <div className="truncate">
                        <div
                          className={`font-extrabold text-slate-900 truncate leading-tight ${
                            layout.cardSize === 'compact' ? 'text-xs' : 'text-sm'
                          }`}
                        >
                          {student.preferredName || student.firstName} {student.lastName}
                        </div>
                        {student.preferredName && layout.cardSize === 'standard' && (
                          <span className="text-[10px] text-slate-400 block leading-none mt-0.5">
                            ({student.firstName})
                          </span>
                        )}
                        {student.pronouns && layout.cardSize === 'standard' && (
                          <span className="text-[10px] text-slate-500 block leading-none mt-0.5 font-medium">
                            {student.pronouns}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Attendance, Profile & Settings Quick Actions */}
                    <div className="flex items-center space-x-0.5">
                      <button
                        onClick={e => handleToggleAttendance(enr!.id, e)}
                        className={`p-1 rounded transition ${
                          isAbsent
                            ? 'text-red-600 hover:bg-red-50'
                            : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                        title={isAbsent ? 'Mark Present' : 'Mark Absent'}
                        aria-label={isAbsent ? `Mark ${student.firstName} ${student.lastName} present` : `Mark ${student.firstName} ${student.lastName} absent`}
                      >
                        {isAbsent ? (
                          <UserX className="w-3.5 h-3.5 text-red-500" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {onOpenStudentSettings && (
                        <button
                          type="button"
                          data-testid="student-settings-gear-btn"
                          onClick={e => {
                            e.stopPropagation();
                            onOpenStudentSettings(student);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition"
                          title="Edit Student Settings"
                          aria-label={`Edit ${student.firstName} ${student.lastName} settings`}
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onOpenStudentProfile(enr!.id);
                        }}
                        data-testid="open-student-profile-btn"
                        className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                        title="Open Full Profile"
                        aria-label={`Open full profile for ${student.firstName} ${student.lastName}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Bottom Row: Participation Badges & Note Indicator */}
                  <div className="flex items-center justify-between text-[10px] font-semibold mt-auto pt-1">
                    <div className="flex items-center space-x-1">
                      {isAbsent ? (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold uppercase tracking-wider">
                          Absent
                        </span>
                      ) : (
                        <>
                          {summary && summary.positiveCount > 0 && (
                            <span data-testid="student-counter-badge" className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                              +{summary.positiveCount}
                            </span>
                          )}
                          {summary && summary.neutralCount > 0 && (
                            <span data-testid="student-counter-badge" className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700">
                              ~{summary.neutralCount}
                            </span>
                          )}
                          {summary && summary.needsFollowupCount > 0 && (
                            <span data-testid="student-counter-badge" className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                              !{summary.needsFollowupCount}
                            </span>
                          )}
                          {(!summary || (summary.positiveCount === 0 && summary.needsFollowupCount === 0 && (summary.neutralCount || 0) === 0)) && (
                            <span data-testid="student-counter-badge" className="text-slate-600">No events</span>
                          )}
                        </>
                      )}
                    </div>

                    <span className="text-slate-600 font-mono">
                      #{student.localStudentNumber}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Unseated Students Section */}
        {unseatedEnrollments.length > 0 && (
          <div className="mt-8 max-w-4xl mx-auto bg-amber-50/70 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                  Unassigned Students ({unseatedEnrollments.length})
                </h3>
              </div>
              <button
                onClick={handleArrangeAlphabetically}
                disabled={layout.isLocked}
                className="text-xs font-bold text-amber-900 bg-amber-200/80 hover:bg-amber-300 px-3 py-1 rounded-lg transition disabled:opacity-50"
              >
                Auto-Assign to Empty Desks
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {unseatedEnrollments.map(enr => {
                const student = studentMap.get(enr.studentId);
                if (!student) return null;
                const isSelected = selectedEnrollmentIds.includes(enr.id);
                return (
                  <button
                    key={enr.id}
                    onClick={() => onToggleSelectStudent(enr.id)}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span>{student.firstName} {student.lastName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Randomize Confirmation Modal */}
      {showRandomConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-2">
              Randomize Seating Arrangement?
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              This will randomly shuffle all currently seated students into available desk slots.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowRandomConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRandomize}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
              >
                Confirm Randomize
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
