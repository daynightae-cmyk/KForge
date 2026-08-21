import os
import sys
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QFileDialog,
    QLabel, QLineEdit, QComboBox, QTableWidget, QTableWidgetItem,
    QMessageBox, QHeaderView, QCheckBox, QApplication
)
from PyQt6.QtCore import Qt, QObject, QThread, pyqtSignal
from PyQt6.QtGui import QIcon

# Mock DuplicatePair class for demonstration
class DuplicatePair:
    def __init__(self, file1, file2, similarity, comparison_type, is_marked_for_deletion=False):
        self.file1 = file1
        self.file2 = file2
        self.similarity = similarity
        self.comparison_type = comparison_type
        self.is_marked_for_deletion = is_marked_for_deletion

class ScanControlsWidget(QWidget):
    scan_requested = pyqtSignal(str, str)  # directory_path, scan_type

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setLayout(QHBoxLayout(self))

        self.path_edit = QLineEdit()
        self.path_edit.setPlaceholderText("Enter folder path or select...")
        self.path_edit.setReadOnly(True)
        self.browse_button = QPushButton("Browse")
        self.browse_button.clicked.connect(self.browse_folder)

        self.scan_type_combo = QComboBox()
        self.scan_type_combo.addItems(["hash", "image_visual", "code", "document", "music", "empty_file"])
        self.scan_type_combo.setCurrentText("hash")

        self.scan_button = QPushButton("Scan")
        self.scan_button.clicked.connect(self.request_scan)
        self.scan_button.setStyleSheet("background-color: #28a745; color: white; font-weight: bold;")
        self.scan_button.setFixedWidth(100)

        control_panel_layout = QVBoxLayout()
        path_layout = QHBoxLayout()
        path_layout.addWidget(QLabel("Scan Path:"))
        path_layout.addWidget(self.path_edit)
        path_layout.addWidget(self.browse_button)

        type_layout = QHBoxLayout()
        type_layout.addWidget(QLabel("Scan Type:"))
        type_layout.addWidget(self.scan_type_combo)
        type_layout.addStretch()

        control_panel_layout.addLayout(path_layout)
        control_panel_layout.addLayout(type_layout)
        control_panel_layout.addWidget(self.scan_button, alignment=Qt.AlignmentFlag.AlignRight)

        self.layout().addLayout(control_panel_layout)

    def browse_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Folder to Scan")
        if folder:
            self.path_edit.setText(folder)

    def request_scan(self):
        path = self.path_edit.text()
        scan_type = self.scan_type_combo.currentText()
        if path:
            self.scan_requested.emit(path, scan_type)
        else:
            QMessageBox.warning(self, "Input Error", "Please select a folder to scan.")

class ResultsTableWidget(QTableWidget):
    delete_requested = pyqtSignal(object)  # DuplicatePair
    backup_requested = pyqtSignal(object)
    undo_requested = pyqtSignal(object)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setColumnCount(6)
        self.setHorizontalHeaderLabels(["File 1", "File 2", "Similarity", "Type", "Status", "Actions"])
        self.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.setAlternatingRowColors(True)
        self.resizeColumnsToContents()
        self.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Interactive)
        self.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Interactive)
        self.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Fixed)
        self.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.Fixed)
        self.setSortingEnabled(True)
        self.sort_order = {
            0: Qt.SortOrder.AscendingOrder,
            1: Qt.SortOrder.AscendingOrder,
            2: Qt.SortOrder.AscendingOrder
        }
        self.current_data = []
        self._checkbox_col_index = 4

    def populate_table(self, pairs):
        self.current_data = pairs
        self.setRowCount(len(pairs))
        for i, pair in enumerate(pairs):
            item1 = QTableWidgetItem(pair.file1)
            item2 = QTableWidgetItem(pair.file2)
            sim_item = QTableWidgetItem(f"{pair.similarity:.2f}")
            sim_item.setTextAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            type_item = QTableWidgetItem(pair.comparison_type)

            self.setItem(i, 0, item1)
            self.setItem(i, 1, item2)
            self.setItem(i, 2, sim_item)
            self.setItem(i, 3, type_item)

            checkbox_widget = QWidget()
            checkbox_layout = QHBoxLayout(checkbox_widget)
            checkbox_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
            checkbox_layout.setContentsMargins(0,0,0,0)

            checkbox = QCheckBox()
            checkbox.setChecked(pair.is_marked_for_deletion)
            checkbox.stateChanged.connect(lambda state, index=i: self.toggle_deletion_mark(index, state))

            checkbox_layout.addWidget(checkbox)
            self.setCellWidget(i, self._checkbox_col_index, checkbox_widget)

            actions_cell_widget = QWidget()
            actions_layout = QHBoxLayout(actions_cell_widget)
            actions_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
            actions_layout.setContentsMargins(0,0,0,0)
            self.setCellWidget(i, 5, actions_cell_widget)

        self.resizeColumnsToContents()
        self.horizontalHeader().sectionClicked.connect(self.header_section_clicked)

    def toggle_deletion_mark(self, row_index, state):
        if 0 <= row_index < len(self.current_data):
            pair = self.current_data[row_index]
            pair.is_marked_for_deletion = (state == Qt.CheckState.Checked.value)
            self.parentWidget().update_action_buttons()

    def header_section_clicked(self, logicalIndex):
        if logicalIndex in [0, 1, 2]:
            order = self.sort_order.get(logicalIndex, Qt.SortOrder.AscendingOrder)
            self.sortColumnAndToggleOrder(logicalIndex, order)

    def sortColumnAndToggleOrder(self, column, order):
        self.setSortingEnabled(False)
        self.sortItems(column, order)
        new_order = Qt.SortOrder.DescendingOrder if order == Qt.SortOrder.AscendingOrder else Qt.SortOrder.AscendingOrder
        self.sort_order[column] = new_order
        self.setSortingEnabled(True)

    def clear_table(self):
        self.setRowCount(0)
        self.current_data = []

class RemoveDuplicatePROWindow(QWidget):
    def __init__(self, parent=None, manager=None):
        super().__init__(parent)
        if manager is None:
            raise ValueError("RemoveDuplicatePROManager must be provided.")
        self.manager = manager
        self.setWindowTitle(f"Knoux - {self.parent().windowTitle()} - Remove Duplicates")

        self.layout = QVBoxLayout(self)
        self.setLayout(self.layout)

        self.scan_controls = ScanControlsWidget(self)
        self.scan_controls.scan_requested.connect(self.trigger_scan_operation)
        self.layout.addWidget(self.scan_controls)

        self.results_table = ResultsTableWidget(self)
        self.layout.addWidget(self.results_table)

        self.action_buttons_layout = QHBoxLayout()
        self.scan_button_widget = self.scan_controls.scan_button
        self.scan_button_widget.setEnabled(True)
        self.scan_button_widget.clicked.connect(self.trigger_scan_operation)

        self.delete_selected_button = QPushButton("Delete Selected")
        self.backup_selected_button = QPushButton("Backup Selected")
        self.undo_last_button = QPushButton("Undo Last Operation")
        self.export_results_button = QPushButton("Export Results")

        self.delete_selected_button.setStyleSheet("background-color: #dc3545; color: white;")
        self.backup_selected_button.setStyleSheet("background-color: #ffc107; color: black;")
        self.undo_last_button.setStyleSheet("background-color: #6c757d; color: white;")
        self.export_results_button.setStyleSheet("background-color: #007bff; color: white;")

        self.delete_selected_button.setEnabled(False)
        self.backup_selected_button.setEnabled(False)
        self.undo_last_button.setEnabled(False)
        self.export_results_button.setEnabled(False)

        self.action_buttons_layout.addWidget(self.delete_selected_button)
        self.action_buttons_layout.addWidget(self.backup_selected_button)
        self.action_buttons_layout.addWidget(self.undo_last_button)
        self.action_buttons_layout.addStretch()
        self.action_buttons_layout.addWidget(self.export_results_button)

        self.layout.addLayout(self.action_buttons_layout)

        self.delete_selected_button.clicked.connect(self.execute_deletion)
        self.backup_selected_button.clicked.connect(self.execute_backup)
        self.undo_last_button.clicked.connect(self.execute_undo)
        self.export_results_button.clicked.connect(self.export_scan_results)

        self.scan_controls.scan_requested.connect(self.trigger_scan_operation)

        self.update_action_buttons()

    def update_action_buttons(self):
        has_controls = self.scan_controls and self.scan_controls.path_edit.text() and self.scan_controls.scan_type_combo.currentText()
        has_results = bool(self.results_table.current_data)
        items_marked = any(p.is_marked_for_deletion for p in self.results_table.current_data) if has_results else False

        self.scan_button_widget.setEnabled(True)
        self.delete_selected_button.setEnabled(has_results and items_marked)
        self.backup_selected_button.setEnabled(has_results and items_marked)
        self.undo_last_button.setEnabled(True)
        self.export_results_button.setEnabled(has_results)

    def trigger_scan_operation(self, directory_path=None, scan_type=None):
        if directory_path is None:
            directory_path = self.scan_controls.path_edit.text()
        if scan_type is None:
            scan_type = self.scan_controls.scan_type_combo.currentText()
        if not directory_path:
            QMessageBox.warning(self, "Input Error", "Please select a folder to scan first.")
            return

        self.scan_button_widget.setEnabled(False)
        self.results_table.clear_table()
        QApplication.processEvents()

        self.scan_thread = QThread()
        self.worker = ScanWorker(self.manager, directory_path, scan_type)
        self.worker.moveToThread(self.scan_thread)

        self.scan_thread.started.connect(self.worker.run_scan)
        self.worker.finished_scan.connect(self.display_scan_results)
        self.worker.error_scan.connect(self.handle_scan_error)
        self.worker.finished_scan.connect(self.scan_thread.quit)
        self.scan_thread.start()

        self.worker.finished_scan.connect(lambda: self.scan_button_widget.setEnabled(True))
        self.worker.error_scan.connect(lambda: self.scan_button_widget.setEnabled(True))

    def display_scan_results(self, pairs):
        if pairs is None:
            QMessageBox.critical(self, "Scan Error", "An error occurred during the scan operation. Please check logs.")
            self.scan_button_widget.setEnabled(True)
            return

        self.results_table.populate_table(pairs)
        self.update_action_buttons()
        self.scan_button_widget.setEnabled(True)

    def handle_scan_error(self, error_message):
        QMessageBox.critical(self, "Scan Error", f"Error during scan: {error_message}\nPlease check logs for more details.")
        self.scan_button_widget.setEnabled(True)
        self.results_table.clear_table()
        self.update_action_buttons()

    def execute_deletion(self):
        marked_pairs = [p for p in self.results_table.current_data if p.is_marked_for_deletion]
        if not marked_pairs:
            QMessageBox.information(self, "No Selection", "Please mark items for deletion first.")
            return

        reply = QMessageBox.question(self, 'Confirm Deletion',
                                     f"Are you sure you want to delete {len(marked_pairs)} selected items?\n"
                                     "This action is irreversible without a backup.\n"
                                     "Ensure critical files are backed up.",
                                     QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.Cancel,
                                     QMessageBox.StandardButton.Cancel)

        if reply == QMessageBox.StandardButton.Yes:
            self.statusBar().showMessage("Deleting selected items...")
            QApplication.processEvents()

            backup_reply = QMessageBox.question(self, 'Backup Confirmation',
                                               'Do you want to back up the selected items before deletion?',
                                               QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                                               QMessageBox.StandardButton.Yes)
            perform_backup = (backup_reply == QMessageBox.StandardButton.Yes)

            safe_delete_reply = QMessageBox.question(self, 'Safe Deletion',
                                                     'Use Safe Deletion (move to trash/quarantine) instead of permanent delete?',
                                                     QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                                                     QMessageBox.StandardButton.Yes)
            use_safe_delete = (safe_delete_reply == QMessageBox.StandardButton.Yes)

            try:
                result = self.manager.perform_deletion(marked_pairs, perform_backup=perform_backup, auto_delete_safe=use_safe_delete)
            except Exception as e:
                QMessageBox.critical(self, "Deletion Error", f"An error occurred: {str(e)}", QMessageBox.StandardButton.Ok)
                self.statusBar().showMessage(f"Deletion failed: {str(e)}")
                return

            if result.get("status") == "success":
                QMessageBox.information(self, "Deletion Complete", result.get("message", ""), QMessageBox.StandardButton.Ok)
                self.statusBar().showMessage(f"Deletion completed: {result.get('message')}")
            else:
                QMessageBox.critical(self, "Deletion Error", result.get("message", "An error occurred during deletion."), QMessageBox.StandardButton.Ok)
                self.statusBar().showMessage(f"Deletion failed: {result.get('message')}")

            self.update_action_buttons()

    def execute_backup(self):
        marked_pairs = [p for p in self.results_table.current_data if p.is_marked_for_deletion]
        if not marked_pairs:
            QMessageBox.information(self, "No Selection", "Please mark items to back up first.")
            return

        self.statusBar().showMessage("Backing up selected items...")
        QApplication.processEvents()

        result = self.manager.perform_deletion(marked_pairs, perform_backup=True, auto_delete_safe=False)

        if result.get("status") == "success":
            QMessageBox.information(self, "Backup Complete", f"Backup successful for {result.get('success_count')} items.", QMessageBox.StandardButton.Ok)
            self.statusBar().showMessage(f"Backup complete: {result.get('message')}")
        else:
            QMessageBox.critical(self, "Backup Error", f"Backup failed: {result.get('message')}", QMessageBox.StandardButton.Ok)
            self.statusBar().showMessage(f"Backup failed: {result.get('message')}")
        self.update_action_buttons()

    def execute_undo(self):
        self.statusBar().showMessage("Undoing last operation...")
        QApplication.processEvents()

        if self.manager.undo_last_operation():
            QMessageBox.information(self, "Undo Success", "The last operation was undone.", QMessageBox.StandardButton.Ok)
            self.statusBar().showMessage("Last operation undone.")
        else:
            QMessageBox.warning(self, "Undo Failed", "Could not undo the last operation, or no operation was recorded.", QMessageBox.StandardButton.Ok)
            self.statusBar().showMessage("Undo failed.")

        self.update_action_buttons()

    def export_scan_results(self):
        # Placeholder for export functionality
        QMessageBox.information(self, "Export", "Export functionality is not implemented yet.")

class ScanWorker(QObject):
    finished_scan = pyqtSignal(list)
    error_scan = pyqtSignal(str)

    def __init__(self, manager, directory_path, scan_type):
        super().__init__()
        self.manager = manager
        self.directory_path = directory_path
        self.scan_type = scan_type
        self._is_running = False

    def run_scan(self):
        self._is_running = True
        try:
            results = self.manager.scan_directory(self.directory_path, self.scan_type)
            self.finished_scan.emit(results)
        except Exception as e:
            self.error_scan.emit(str(e))
        finally:
            self._is_running = False
