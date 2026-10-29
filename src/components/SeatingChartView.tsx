import { safePhotoSource } from '../utils/localPhoto';
import { createPortal } from 'react-dom';
import { consumeStudentPress, registerStudentPress } from './studentPress';
import { ModalDialog } from './ModalDialog';
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
import { ClassroomStructureService } from '../services/classroomStructureService';
import { SeatingDomainService } from '../services/seatingService';
import { AttendanceService } from '../services/attendanceService';
import { getAppIdentity, getIdentityEpoch } from '../services/identityService';
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
  onToggleSelectStudent: (enrollmentId: UUID) => void | (() => void);
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
  const [showClassTools, setShowClassTools] = useState(false);
  const [showRandomConfirm, setShowRandomConfirm] = useState(false);
  const [draggedSeat, setDraggedSeat] = useState<SeatPosition | null>(null);
  const [tapMoveMode, setTapMoveMode] = useState(false);
  const [tapMoveSource, setTapMoveSource] = useState<SeatPosition | null>(null);
  const [seatingBusy, setSeatingBusy] = useState(false);
  const [seatingError, setSeatingError] = useState<string | null>(null);
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
  enrollments.filter(e => e.deletedAt === null && e.enrollmentStatus === 'active').forEach(e => enrollmentMap.set(e.id, e));

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
      const pos = seatPositions.find(p => p.row === r && p.col === c && p.deletedAt === null && enrollmentMap.has(p.classEnrollmentId));
      rowArr.push(pos || null);
    }
    grid.push(rowArr);
  }

  const updateLayout = async (changes: Partial<Pick<SeatingLayout, 'rows' | 'cols' | 'isLocked' | 'cardSize'>>) => {
    const identityEpoch = getIdentityEpoch();
    setSeatingError(null);
    try {
      if (!userId || !deviceId) throw new AuthorizationError('Select an acting teacher before editing the classroom.');
      await new ClassroomStructureService(db).updateLayout(layout.id, layout.version, changes, { userId, deviceId, identityEpoch });
      onRefresh();
    } catch (error) {
      setSeatingError(error instanceof Error ? error.message : 'Classroom layout could not be updated.');
    }
  };
  const handleToggleLock = () => updateLayout({ isLocked: !layout.isLocked });
  const handleToggleSize = () => updateLayout({ cardSize: layout.cardSize === 'standard' ? 'compact' : 'standard' });
  const handleAddRow = () => updateLayout({ rows: layout.rows + 1 });
  const handleRemoveRow = () => { if (layout.rows > 2) return updateLayout({ rows: layout.rows - 1 }); };
  const handleAddCol = () => updateLayout({ cols: layout.cols + 1 });
  const handleRemoveCol = () => { if (layout.cols > 2) return updateLayout({ cols: layout.cols - 1 }); };

  const getIdentity = async () => {
    const currentIdentity = await getAppIdentity(db);
    if (userId && userId !== currentIdentity.userId) {
      throw new AuthorizationError('Acting teacher has changed. Please refresh.');
    }
    return currentIdentity;
  };

  const runSeatingAction = async (action: 'populate' | 'alphabetical' | 'randomize') => {
    if (seatingBusy) return;
    setSeatingBusy(true);
    setSeatingError(null);
    try {
      const id = await getIdentity();
      if (action === 'populate') await seatingService.populateEmptySeats(layout.id, id.userId, id.deviceId);
      else if (action === 'alphabetical') await seatingService.arrangeAlphabetically(layout.id, id.userId, id.deviceId);
      else await seatingService.randomizeSeats(layout.id, id.userId, id.deviceId);
      setShowRandomConfirm(false);
      onRefresh();
    } catch (error) {
      setSeatingError(error instanceof Error ? error.message : 'Seating could not be updated. Please try again.');
    } finally {
      setSeatingBusy(false);
    }
  };
  const handleArrangeAlphabetically = () => runSeatingAction('alphabetical');
  const handlePopulate = () => runSeatingAction('populate');
  const handleConfirmRandomize = () => runSeatingAction('randomize');

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
      {unseatedEnrollments.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-amber-900">{unseatedEnrollments.length} students need desks. Populate seating to place them in empty desks; existing assignments stay in place.{layout.isLocked ? ' Unlock seating first.' : ''}</p>
          <button onClick={handlePopulate} disabled={layout.isLocked || seatingBusy}
            className="px-4 py-2 rounded-xl bg-amber-200 text-sm font-bold disabled:opacity-50">Populate seating</button>
        </div>
      )}
      {seatingError && !showRandomConfirm && <p role="alert" className="mb-4 text-sm text-rose-700">{seatingError}</p>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-semibold">Class participation</h2><p className="text-sm text-slate-600">Choose a student to record feedback.</p></div>
        <button type="button" aria-expanded={showClassTools} aria-controls="classroom-tools" data-testid="classroom-tools-toggle"
          className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
          onClick={() => { setShowClassTools(!showClassTools); setTapMoveMode(false); setTapMoveSource(null); }}>
          {showClassTools ? 'Return to participation' : 'Attendance & seating tools'}
        </button>
      </div>
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

        <div id="classroom-tools" hidden={!showClassTools} className={showClassTools ? 'flex flex-wrap items-center gap-3 w-full' : ''}>
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
            disabled={layout.isLocked || seatingBusy}
            className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl transition disabled:opacity-50"
            title="Arrange Alphabetically"
          >
            <SortAsc className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Alphabetical</span>
          </button>

          <button
            onClick={() => { setSeatingError(null); setShowRandomConfirm(true); }}
            disabled={layout.isLocked || seatingBusy || seatedEnrollmentIds.size < 2}
            className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl transition disabled:opacity-50"
            title={layout.isLocked ? "Unlock seating before randomizing" : seatedEnrollmentIds.size < 2 ? "Populate at least two desks before randomizing" : "Randomize Seats"}
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
      </div>

      {/* Classroom Front Stage Indicator */}
      <div className="w-full max-w-md mx-auto mb-8 text-center">
        <div className="h-1.5 bg-slate-300 rounded-full mb-1" />
        <span className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">
          Front of Classroom &bull; Whiteboard / Screen
        </span>
      </div>

      {/* Seating Grid */}
      {showClassTools && !layout.isLocked && (
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
      <div className="overflow-x-auto pb-24" data-testid="seating-scroll">
        <div
          className="grid gap-3 mx-auto w-full"
          data-testid="seating-grid"
          style={{
            // Keep the first column within the scrollable origin. Centering tracks
            // wider than their container placed touch actions beyond its left edge.
            minWidth: `calc(${layout.cols} * ${layout.cardSize === 'compact' ? '140px' : '190px'} + ${Math.max(0, layout.cols - 1)} * 0.75rem)`,
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
                      layout.cardSize === 'compact' ? 'min-h-20' : 'min-h-28'
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
                  data-enrollment-id={enr!.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={tapMoveMode ? tapMoveSource?.id === seatPos.id : isSelected}
                  draggable={showClassTools && !layout.isLocked && !tapMoveMode}
                  onDragStart={() => handleDragStart(seatPos)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDrop(r, c)}
                  ref={element => registerStudentPress(element, tapMoveMode ? null : () => onToggleSelectStudent(enr!.id))}
                  onPointerDown={event => {
                    if (tapMoveMode || !event.isPrimary || event.button !== 0 || (event.target as Element).closest('button,input,select,textarea,a')) return;
                    event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
                    consumeStudentPress(event, event.currentTarget, onToggleSelectStudent(enr!.id), showClassTools && !layout.isLocked);
                  }}
                  onClick={event => { if (tapMoveMode || event.detail === 0) void handleTapSeat(r, c, seatPos); }}
                  onKeyDown={e => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      void handleTapSeat(r, c, seatPos);
                    }
                  }}
                  className={`relative rounded-2xl border transition-all cursor-pointer select-none p-3 flex flex-col justify-between ${
                    layout.cardSize === 'compact' ? 'min-h-20' : 'min-h-28'
                  } ${
                    (tapMoveMode ? tapMoveSource?.id === seatPos.id : isSelected)
                      ? 'ring-2 ring-blue-600 border-blue-600 bg-blue-50/60 shadow-md'
                      : showClassTools && isAbsent
                      ? 'bg-slate-100 border-slate-300 opacity-60'
                      : isHighlighted
                      ? 'ring-2 ring-amber-400 border-amber-400 bg-amber-50 shadow-md'
                      : 'bg-white border-slate-200/90 hover:border-slate-300 hover:shadow-sm'
                  }`}
                >
                  {/* Top Row: Name, Photo/Initials & Quick Actions */}
                  <div className="seat-card-top flex flex-wrap items-start gap-y-2">
                    <div className="flex w-full min-w-0 items-start gap-2.5">
                      {/* Student Photo or Stylized Initials Avatar */}
                      {showClassTools && (safePhotoSource(student.photoUrl) ? (
                        <img
                          src={safePhotoSource(student.photoUrl)}
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
                      ))}

                      <div className="min-w-0 flex-1">
                        <div
                          data-testid="student-seat-name"
                          className="text-sm font-extrabold leading-snug text-slate-900"
                          style={{ overflowWrap: 'anywhere' }}
                        >
                          {student.preferredName || student.firstName} {student.lastName}
                        </div>
                        {student.preferredName && student.preferredName !== student.firstName && (
                          <span data-testid="student-seat-full-name" className="mt-1 block text-sm leading-snug text-slate-600" style={{ overflowWrap: 'anywhere' }}>
                            {student.firstName} {student.lastName}
                          </span>
                        )}
                        {showClassTools && student.pronouns && layout.cardSize === 'standard' && (
                          <span className="text-[10px] text-slate-500 block leading-none mt-0.5 font-medium">
                            {student.pronouns}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Attendance, Profile & Settings Quick Actions */}
                    <div className={`seat-card-actions ${!showClassTools || tapMoveMode ? 'hidden' : 'flex w-full flex-wrap items-center justify-end gap-1'}`}>
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
                          ref={element => registerStudentPress(element, () => onOpenStudentSettings(student))}
                          onPointerDown={event => {
                            if (!event.isPrimary || event.button !== 0) return;
                            event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
                            onOpenStudentSettings(student); consumeStudentPress(event);
                          }}
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
                        ref={element => registerStudentPress(element, () => onOpenStudentProfile(enr!.id))}
                        onPointerDown={event => {
                          if (!event.isPrimary || event.button !== 0) return;
                          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
                          onOpenStudentProfile(enr!.id); consumeStudentPress(event);
                        }}
                        className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                        title="Open Full Profile"
                        aria-label={`Open full profile for ${student.firstName} ${student.lastName}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Bottom Row: Participation Badges & Note Indicator */}
                  <div hidden={!showClassTools} className={showClassTools ? "flex items-center justify-between text-[10px] font-semibold mt-auto pt-1" : undefined}>
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
                onClick={handlePopulate}
                disabled={layout.isLocked || seatingBusy}
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
                    ref={element => registerStudentPress(element, () => onToggleSelectStudent(enr.id))}
                    onPointerDown={event => {
                      if (!event.isPrimary || event.button !== 0) return;
                      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
                      consumeStudentPress(event, event.currentTarget, onToggleSelectStudent(enr.id));
                    }}
                    onClick={event => { if (event.detail === 0) onToggleSelectStudent(enr.id); }}
                    className={`flex max-w-full min-w-0 items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium text-left transition ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="min-w-0 whitespace-normal" style={{ overflowWrap: 'anywhere' }}>{student.firstName} {student.lastName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Above the fixed participation dock, with the shared focus/keyboard handling. */}
      {showRandomConfirm && createPortal(
        <div className="fixed inset-0 z-[60]">
          <ModalDialog isOpen={showRandomConfirm} onClose={() => { if (!seatingBusy) setShowRandomConfirm(false); }}
            title="Randomize Seating Arrangement?" ariaDescribedBy="randomize-description">
            <div className="p-6">
              <p id="randomize-description" className="text-sm text-slate-600 mb-4">
                This will shuffle currently seated students among their occupied desks. Unassigned students stay unassigned.
              </p>
              {seatingError && <p role="alert" className="mb-4 text-sm text-rose-700">{seatingError}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowRandomConfirm(false)} disabled={seatingBusy} className="px-3 py-2 rounded-lg">Cancel</button>
                <button onClick={handleConfirmRandomize} disabled={layout.isLocked || seatingBusy || seatedEnrollmentIds.size < 2}
                  className="px-4 py-2 font-bold text-white bg-blue-600 rounded-lg disabled:opacity-50">
                  {seatingBusy ? 'Randomizing…' : 'Confirm Randomize'}
                </button>
              </div>
            </div>
          </ModalDialog>
        </div>, document.body
      )}
    </div>
  );
};
